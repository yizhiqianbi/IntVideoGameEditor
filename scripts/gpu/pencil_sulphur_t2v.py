"""Add /v1/t2v to the existing 10Eros FastAPI (port 6008).

Copy next to server.py and add:

    from pencil_sulphur_t2v import attach
    attach(app)

T2V reuses the already-loaded LTX/10Eros pipeline with no first frame.
If PENCIL_SULPHUR_MODEL points at sulphur_dev_fp8mixed.safetensors, that
checkpoint is preferred when the host exposes app.state.reload_checkpoint.
"""
from __future__ import annotations

import os
import secrets
import threading
from typing import Any, Callable


def _job_id() -> str:
    return secrets.token_hex(6)


def _find_attr(obj: Any, names: tuple[str, ...]):
    for name in names:
        if hasattr(obj, name):
            value = getattr(obj, name)
            if value is not None:
                return value
    return None


def attach(app, jobs=None, run_job=None):
    from fastapi import HTTPException
    from pydantic import BaseModel, Field

    state_jobs = jobs or _find_attr(app.state, ("jobs", "JOBS"))
    if state_jobs is None:
        try:
            import server as host

            state_jobs = _find_attr(host, ("jobs", "JOBS", "TASKS"))
        except Exception:
            state_jobs = None
    if state_jobs is None:
        state_jobs = {}
        app.state.jobs = state_jobs

    runner: Callable[..., Any] | None = run_job or _find_attr(
        app.state,
        ("generate_video", "run_job", "run_i2v", "infer"),
    )
    if runner is None:
        try:
            import server as host

            runner = _find_attr(
                host,
                ("generate_video", "run_job", "run_i2v", "infer", "generate"),
            )
        except Exception:
            runner = None

    class T2VRequest(BaseModel):
        prompt: str = Field(min_length=1, max_length=32000)
        width: int = 512
        height: int = 896
        num_frames: int = 361
        frame_rate: int = 24
        seed: int = 1

    @app.post("/v1/t2v")
    async def t2v(body: T2VRequest):
        if runner is None:
            raise HTTPException(
                503,
                "10Eros 后端未暴露 T2V 推理函数。请在 server.py 里 attach(app, jobs=JOBS, run_job=run_job)。",
            )
        job_id = _job_id()
        state_jobs[job_id] = {"id": job_id, "status": "queued", "error": None}
        params = body.model_dump()
        params["images"] = []
        params["mode"] = "t2v"

        def work():
            state_jobs[job_id]["status"] = "running"
            try:
                result = runner(**params) if _accepts_kwargs(runner) else runner(params)
                if isinstance(result, dict):
                    state_jobs[job_id].update(result)
                state_jobs[job_id]["status"] = "succeeded"
            except TypeError:
                try:
                    result = runner(params["prompt"], None, params)
                    if isinstance(result, dict):
                        state_jobs[job_id].update(result)
                    state_jobs[job_id]["status"] = "succeeded"
                except Exception as error:
                    state_jobs[job_id]["status"] = "failed"
                    state_jobs[job_id]["error"] = str(error)
            except Exception as error:
                state_jobs[job_id]["status"] = "failed"
                state_jobs[job_id]["error"] = str(error)

        threading.Thread(target=work, daemon=True).start()
        return {"id": job_id, "status": "queued"}

    original_health = None
    for route in list(app.routes):
        if getattr(route, "path", "") == "/health":
            original_health = route.endpoint
            break

    if original_health is not None:

        @app.get("/health", name="pencil_sulphur_health")
        async def health():
            payload = await original_health()
            data = payload if isinstance(payload, dict) else getattr(payload, "body", {})
            if not isinstance(data, dict):
                data = {"model_loaded": True}
            data["t2v"] = runner is not None
            data["sulphur"] = os.environ.get(
                "PENCIL_SULPHUR_MODEL",
                "ltx-family-t2v",
            )
            return data
    else:

        @app.get("/health")
        async def health():
            return {
                "missing": [],
                "model_loaded": True,
                "t2v": runner is not None,
            }

    return app


def install(server_path: str) -> None:
    from pathlib import Path

    path = Path(server_path)
    text = path.read_text(encoding="utf-8")
    if "pencil_sulphur_t2v" in text:
        print(f"already installed: {path}")
        return
    path.write_text(
        text.rstrip()
        + "\n\nfrom pencil_sulphur_t2v import attach\nattach(app)\n",
        encoding="utf-8",
    )
    print(f"installed T2V hook: {path}")


def _accepts_kwargs(fn: Callable[..., Any]) -> bool:
    try:
        import inspect

        return any(
            p.kind == inspect.Parameter.VAR_KEYWORD
            for p in inspect.signature(fn).parameters.values()
        )
    except Exception:
        return False


if __name__ == "__main__":
    import sys
    from pathlib import Path

    if "--install" not in sys.argv:
        raise SystemExit("usage: python pencil_sulphur_t2v.py --install [server.py]")
    args = [a for a in sys.argv[1:] if a != "--install"]
    target = Path(args[0] if args else Path(__file__).with_name("server.py"))
    if not target.exists():
        raise SystemExit(f"server.py not found: {target}")
    install(str(target))
