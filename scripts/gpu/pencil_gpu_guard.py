"""One GPU owner at a time: H3, Flux, or LTX.

RTX 5090 32GB cannot hold H3 (~26GB) plus Flux / LTX. Callers take
LOCK, switch holder, then run.
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import threading
import uuid
from aiohttp import ClientSession, ClientTimeout
from server import PromptServer
import comfy.model_management
import execution

LOCK = asyncio.Lock()
LTX_BASE = "http://127.0.0.1:6008"
_holder: str | None = None


def holder() -> str | None:
    return _holder


def _queue_size(part) -> int:
    if not part:
        return 0
    if isinstance(part, (list, tuple)):
        if not part:
            return 0
        if isinstance(part[0], (list, tuple)):
            return len(part)
        return 1
    return 1


def prompt_worker_alive() -> bool:
    for thread in threading.enumerate():
        if not thread.is_alive():
            continue
        target = getattr(thread, "_target", None)
        if getattr(target, "__name__", "") == "prompt_worker":
            return True
        if "prompt_worker" in (thread.name or ""):
            return True
    return False


def diagnose():
    q = PromptServer.instance.prompt_queue
    try:
        running, pending = queue_parts(q.get_current_queue())
    except Exception:
        running, pending = (), ()
    worker = prompt_worker_alive()
    n_run = _queue_size(running)
    n_pend = _queue_size(pending)
    return {
        "worker": worker,
        "running": n_run,
        "pending": n_pend,
        "stuck": not worker,
        "gpu_holder": holder(),
    }


def revive_prompt_worker():
    drop_stale_comfy()
    if prompt_worker_alive():
        return True
    fn = getattr(sys.modules.get("__main__"), "prompt_worker", None)
    if not callable(fn):
        return False
    threading.Thread(
        target=fn,
        daemon=True,
        args=(PromptServer.instance.prompt_queue, PromptServer.instance),
        name="prompt_worker-repair",
    ).start()
    return prompt_worker_alive()


def schedule_comfy_restart():
    python = sys.executable
    cwd = "/root/ComfyUI" if os.path.isdir("/root/ComfyUI") else os.getcwd()
    pid = os.getpid()
    log = "/root/pencil-comfyui.log"
    script = f"""
sleep 1
kill -TERM {pid} 2>/dev/null || true
for i in $(seq 1 25); do
  kill -0 {pid} 2>/dev/null || break
  sleep 0.4
done
kill -KILL {pid} 2>/dev/null || true
cd {cwd}
nohup {python} main.py --listen 0.0.0.0 --port 6006 --enable-cors-header --preview-method latent2rgb --preview-size 256 >> {log} 2>&1 < /dev/null &
"""
    subprocess.Popen(
        ["/bin/bash", "-lc", script],
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )


def repair_backend(hard=False):
    info = diagnose()
    if hard:
        return {
            **info,
            "ok": True,
            "action": "restarting",
            "message": "正在重启 Comfy，大约 10 秒后可重新生成。",
        }
    if not info["worker"]:
        revived = revive_prompt_worker()
        info = diagnose()
        if revived or info["worker"]:
            return {
                **info,
                "ok": True,
                "action": "revived",
                "message": "执行线程已拉起，排队中的任务会继续。",
            }
        return {
            **info,
            "ok": True,
            "action": "restarting",
            "message": "无法拉起执行线程，正在重启 Comfy。",
        }
    return {
        **info,
        "ok": True,
        "action": "healthy",
        "message": "后端正常，无需修复。",
    }


def enqueue_comfy(prompt, extra_data=None, outputs_to_execute=None, prompt_id=None):
    """Put a workflow on Comfy's queue using the current 6-tuple format."""
    extra = dict(extra_data or {})
    sensitive = {}
    for key in getattr(execution, "SENSITIVE_EXTRA_DATA_KEYS", ()):
        if key in extra:
            sensitive[key] = extra.pop(key)
    prompt_id = str(prompt_id or uuid.uuid4())
    server = PromptServer.instance
    number = getattr(server, "number", 0)
    server.number = number + 1
    server.prompt_queue.put(
        (number, prompt_id, prompt, extra, outputs_to_execute or [], sensitive)
    )
    return prompt_id, number


def queue_parts(queue):
    if not queue:
        return (), ()
    running = queue[0] if len(queue) > 0 else ()
    pending = queue[1] if len(queue) > 1 else ()
    return running, pending


def interrupt_comfy():
    try:
        import nodes

        try:
            nodes.interrupt_processing(True)
        except TypeError:
            nodes.interrupt_processing()
    except Exception:
        pass
    q = PromptServer.instance.prompt_queue
    try:
        q.wipe_queue()
    except Exception:
        pass
    try:
        q.set_flag("unload_models", True)
        q.set_flag("free_memory", True)
    except Exception:
        pass


def drop_stale_comfy():
    q = PromptServer.instance.prompt_queue
    running, _ = queue_parts(q.get_current_queue())
    if not running:
        return
    try:
        with q.mutex:
            getattr(q, "currently_running", {}).clear()
    except Exception:
        pass


async def release_comfy():
    await asyncio.to_thread(interrupt_comfy)
    q = PromptServer.instance.prompt_queue
    for _ in range(15):
        running, _ = queue_parts(q.get_current_queue())
        if not running:
            break
        await asyncio.sleep(0.2)
    await asyncio.to_thread(drop_stale_comfy)
    await asyncio.to_thread(comfy.model_management.unload_all_models)
    comfy.model_management.soft_empty_cache()


async def _post_ignore(url: str, paths: tuple[str, ...]):
    timeout = ClientTimeout(total=30)
    try:
        async with ClientSession(timeout=timeout) as session:
            for path in paths:
                try:
                    async with session.post(url + path) as response:
                        if response.status == 200:
                            return
                        if response.status in (404, 405):
                            continue
                except (OSError, asyncio.TimeoutError):
                    continue
    except (OSError, asyncio.TimeoutError):
        return


async def release_ltx():
    await _post_ignore(LTX_BASE, ("/v1/release", "/v1/unload"))


async def switch(owner: str):
    """Unload every other family so `owner` can occupy the 5090."""
    global _holder
    if _holder == owner:
        return
    comfy_owners = {"h3", "flux"}
    leaving_comfy = _holder in comfy_owners or _holder is None
    entering_comfy = owner in comfy_owners
    if not entering_comfy or (leaving_comfy and _holder != owner):
        await release_comfy()
    if owner != "ltx":
        await release_ltx()
    _holder = owner


def clear_holder():
    global _holder
    _holder = None


def delete_prompt(prompt_id: str) -> bool:
    if not prompt_id:
        return False
    q = PromptServer.instance.prompt_queue
    try:
        q.delete_queue_item(lambda item: item[1] == prompt_id)
        return True
    except Exception:
        return False


async def cancel_job(family: str, prompt_id: str = ""):
    """Stop a stuck generation and free the 5090."""
    global _holder
    async with LOCK:
        if family == "ltx":
            await release_ltx()
            if _holder == "ltx":
                clear_holder()
            return
        running = False
        if prompt_id:
            q = PromptServer.instance.prompt_queue
            try:
                current, _ = queue_parts(q.get_current_queue())
                running = any(
                    isinstance(item, (list, tuple)) and len(item) > 1 and item[1] == prompt_id
                    for item in current
                )
            except Exception:
                running = False
            await asyncio.to_thread(delete_prompt, prompt_id)
        if running or not prompt_id:
            await release_comfy()
            if _holder in ("h3", "flux", None):
                clear_holder()


NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
