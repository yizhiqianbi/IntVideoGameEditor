"""Add PinkCherry LTX-2.3 checkpoint switching to the 10Eros FastAPI (port 6008).

Copy next to server.py and run:

    python pencil_pinkcherry.py --install server.py

DistilledPipeline loads the bf16 monolith. The Q8_0 GGUF is reported for
ComfyUI GGUFLoaderKJ, but is not loaded by this FastAPI.
"""
import gc
from pathlib import Path

from fastapi import HTTPException, Request


def attach(app):
    import server as host

    base = Path(getattr(host, "BASE", "/root/autodl-tmp/10Eros-backend"))
    eros_default = base / "checkpoints" / "10Eros_v1.2_bf16_ltx.safetensors"
    current = Path(str(getattr(host, "CKPT", eros_default)))
    checkpoints = {
        "10eros": current if current.name.startswith("10Eros") else eros_default,
        "pinkcherry": base
        / "checkpoints"
        / "pinkcherry-v1.8"
        / "v1.8"
        / "PinkCherry_FineTune_bf16_v1_8_LTX23.safetensors",
    }
    gguf = (
        base
        / "checkpoints"
        / "pinkcherry-v1.8"
        / "v1.8"
        / "PinkCherry_FineTune_Q8_0_v1_8_LTX23.gguf"
    )

    def checkpoint_id() -> str:
        try:
            now = Path(str(host.CKPT)).resolve()
        except OSError:
            return "custom"
        for name, path in checkpoints.items():
            try:
                if path.resolve() == now:
                    return name
            except OSError:
                continue
        return "custom"

    def snapshot() -> dict:
        return {
            "checkpoint_id": checkpoint_id(),
            "pinkcherry": checkpoints["pinkcherry"].is_file(),
            "gguf": gguf.is_file(),
            "gguf_path": str(gguf),
            "checkpoints": {
                name: {"path": str(path), "ready": path.is_file()}
                for name, path in checkpoints.items()
            },
        }

    def job_maps():
        seen = []
        for name in ("_jobs", "jobs", "JOBS", "TASKS"):
            value = getattr(host, name, None)
            if isinstance(value, dict) and value not in seen:
                seen.append(value)
                yield value
        extra = getattr(getattr(app, "state", None), "jobs", None)
        if isinstance(extra, dict) and extra not in seen:
            yield extra

    def mark_failed(job, reason: str) -> bool:
        failed = getattr(getattr(host, "JobStatus", None), "failed", "failed")
        active = {
            getattr(getattr(host, "JobStatus", None), "queued", "queued"),
            getattr(getattr(host, "JobStatus", None), "running", "running"),
            "queued",
            "running",
        }
        if isinstance(job, dict):
            if job.get("status") not in active:
                return False
            job["status"] = "failed"
            job["error"] = reason
            return True
        if getattr(job, "status", None) not in active:
            return False
        job.status = failed
        if hasattr(job, "error"):
            job.error = reason
        return True

    def unload_pipeline() -> None:
        host._pipeline = None
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def release_pipeline(reason: str) -> int:
        cancelled = 0
        lock = getattr(host, "_jobs_lock", None)
        if lock is None:
            for jobs in job_maps():
                for job in jobs.values():
                    cancelled += int(mark_failed(job, reason))
        else:
            with lock:
                for jobs in job_maps():
                    for job in jobs.values():
                        cancelled += int(mark_failed(job, reason))
        unload_pipeline()
        return cancelled

    @app.get("/v1/checkpoints")
    def list_checkpoints():
        return snapshot()

    @app.post("/v1/release")
    def release():
        cancelled = release_pipeline("已切换到其他模型")
        return {"ok": True, "cancelled": cancelled, **snapshot(), "gpu": host._gpu_info()}

    @app.post("/v1/checkpoint")
    async def set_checkpoint(request: Request):
        name = request.query_params.get("checkpoint")
        if not name:
            try:
                data = await request.json()
                if isinstance(data, dict):
                    name = data.get("checkpoint")
            except Exception:
                name = None
        if not isinstance(name, str) or not name.strip() or len(name) > 40:
            raise HTTPException(400, "请提供 checkpoint")
        name = name.strip()
        if name not in checkpoints:
            raise HTTPException(400, f"未知 checkpoint：{name}")
        path = checkpoints[name]
        if not path.is_file():
            raise HTTPException(503, f"{name} 权重未下载：{path}")
        try:
            same = Path(str(host.CKPT)).resolve() == path.resolve()
        except OSError:
            same = False
        if not same:
            release_pipeline("已切换 LTX 权重")
            host.CKPT = path
        return {"ok": True, **snapshot(), "gpu": host._gpu_info()}

    return app


def install(server_path: str) -> None:
    path = Path(server_path)
    text = path.read_text(encoding="utf-8")
    if "pencil_pinkcherry" in text:
        print(f"already installed: {path}")
        return
    path.write_text(
        text.rstrip()
        + "\n\nfrom pencil_pinkcherry import attach\nattach(app)\n",
        encoding="utf-8",
    )
    print(f"installed PinkCherry checkpoint hook: {path}")


if __name__ == "__main__":
    import sys

    if "--install" not in sys.argv:
        raise SystemExit("usage: python pencil_pinkcherry.py --install [server.py]")
    args = [a for a in sys.argv[1:] if a != "--install"]
    target = Path(args[0] if args else Path(__file__).with_name("server.py"))
    if not target.exists():
        raise SystemExit(f"server.py not found: {target}")
    install(str(target))
