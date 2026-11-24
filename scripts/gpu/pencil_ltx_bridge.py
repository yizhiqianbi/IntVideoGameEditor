"""Bridge the standalone LTX services into the ComfyUI public gateway."""
import os
import sys
import json
import uuid
import asyncio
from aiohttp import web, ClientSession, ClientTimeout, FormData
from server import PromptServer
import execution
import nodes

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pencil_gpu_guard import LOCK, switch, cancel_job, holder, enqueue_comfy

BASE = "http://127.0.0.1:6008"


async def active_ltx(session):
    async with session.get(BASE + "/v1/jobs") as r:
        if r.status != 200:
            raise RuntimeError("LTX status unavailable")
        return any(j["status"] in ("queued", "running") for j in await r.json())


async def merge_checkpoints(session, data):
    if not isinstance(data, dict):
        return data
    try:
        async with session.get(BASE + "/v1/checkpoints") as extra:
            if extra.status == 200:
                data.update(await extra.json())
    except Exception:
        data.setdefault("pinkcherry", False)
        data.setdefault("gguf", False)
    return data


async def ensure_checkpoint(session, name):
    if not name:
        return None
    async with session.post(BASE + "/v1/checkpoint", json={"checkpoint": name}) as r:
        if r.status in (404, 405):
            return None
        if r.status != 200:
            try:
                data = await r.json()
                detail = data.get("detail") if isinstance(data, dict) else str(data)
            except Exception:
                detail = await r.text()
            return web.json_response({"detail": detail}, status=r.status)
        return None


async def prepare_ltx(request, session):
    # PinkCherry LTX-2.5 runs on its own GPU service. Keep the H3 ComfyUI
    # worker loaded when that checkpoint is selected; the older 10Eros/Sulphur
    # adapters still use the shared GPU guard below.
    if request.query.get("checkpoint") != "pinkcherry25":
        await switch("ltx")
    if await active_ltx(session):
        return web.json_response({"detail": "LTX 已有任务，请完成后再提交。"}, status=409)
    return await ensure_checkpoint(session, request.query.get("checkpoint"))


async def proxy_json(r):
    return web.Response(body=await r.read(), status=r.status, content_type="application/json")


@PromptServer.instance.routes.get("/pencil/ltx/health")
async def health(request):
    try:
        async with ClientSession(timeout=ClientTimeout(total=10)) as session:
            async with session.get(BASE + "/health") as r:
                data = await r.json()
            t2v = bool(data.get("t2v")) if isinstance(data, dict) else False
            if not t2v:
                try:
                    async with session.post(BASE + "/v1/t2v", json={}) as probe:
                        t2v = probe.status != 404
                except Exception:
                    t2v = False
            if isinstance(data, dict):
                data["t2v"] = t2v
                data = await merge_checkpoints(session, data)
            return web.json_response(data, status=r.status)
    except Exception:
        return web.json_response(
            {"missing": ["LTX API offline"], "t2v": False, "pinkcherry": False, "gguf": False},
            status=503,
        )


@PromptServer.instance.routes.post("/pencil/ltx/t2v")
async def create_t2v(request):
    async with LOCK:
        try:
            async with ClientSession(timeout=ClientTimeout(total=55)) as session:
                failed = await prepare_ltx(request, session)
                if failed:
                    return failed
                raw = await request.read()
                ctype = request.headers.get("Content-Type", "application/json")
                if "application/json" in ctype:
                    body = json.loads(raw.decode() or "{}")
                    form = FormData()
                    for key in ("prompt", "width", "height", "num_frames", "frame_rate", "seed"):
                        if key in body and body[key] is not None:
                            form.add_field(key, str(body[key]))
                    async with session.post(BASE + "/v1/t2v", data=form) as r:
                        return await proxy_json(r)
                async with session.post(
                    BASE + "/v1/t2v", data=raw, headers={"Content-Type": ctype}
                ) as r:
                    return await proxy_json(r)
        except Exception as e:
            return web.json_response({"detail": str(e)}, status=503)


@PromptServer.instance.routes.post("/pencil/ltx/i2v")
async def create(request):
    async with LOCK:
        try:
            async with ClientSession(timeout=ClientTimeout(total=55)) as session:
                failed = await prepare_ltx(request, session)
                if failed:
                    return failed
                async with session.post(
                    BASE + "/v1/i2v",
                    data=await request.read(),
                    headers={"Content-Type": request.headers["Content-Type"]},
                ) as r:
                    return await proxy_json(r)
        except Exception as e:
            return web.json_response({"detail": str(e)}, status=503)


@PromptServer.instance.routes.get("/pencil/ltx/jobs/{job_id}")
@PromptServer.instance.routes.get("/pencil/ltx/jobs/{job_id}/video")
async def job(request):
    job_id = request.match_info["job_id"]
    if len(job_id) != 12 or any(c not in "0123456789abcdef" for c in job_id):
        raise web.HTTPBadRequest()
    suffix = "/video" if request.path.endswith("/video") else ""
    async with ClientSession(timeout=ClientTimeout(total=55)) as session:
        headers = {"Range": request.headers["Range"]} if "Range" in request.headers else {}
        async with session.get(BASE + "/v1/jobs/" + job_id + suffix, headers=headers) as r:
            out = web.StreamResponse(
                status=r.status,
                headers={
                    k: v
                    for k, v in r.headers.items()
                    if k.lower()
                    in ("content-type", "content-length", "content-range", "accept-ranges")
                },
            )
            await out.prepare(request)
            async for chunk in r.content.iter_chunked(65536):
                await out.write(chunk)
            return out


async def enqueue_prompt(json_data):
    prompt = json_data.get("prompt")
    if not isinstance(prompt, dict):
        return web.json_response({"error": {"message": "工作流无效"}}, status=400)
    # The acceleration patch is optional; fresh H3 hosts can use native attention.
    # Reconnect every consumer to the original model, retaining its Turbo LoRA.
    if "PathchSageAttentionKJ" not in nodes.NODE_CLASS_MAPPINGS:
        for node_id, node in list(prompt.items()):
            if node.get("class_type") != "PathchSageAttentionKJ":
                continue
            model = node.get("inputs", {}).get("model")
            if not isinstance(model, list) or len(model) != 2:
                continue  # Let normal workflow validation report invalid input.
            for consumer in prompt.values():
                for key, value in list(consumer.get("inputs", {}).items()):
                    if value == [node_id, 0]:
                        consumer["inputs"][key] = model.copy()
            del prompt[node_id]
    prompt_id = str(json_data.get("prompt_id") or uuid.uuid4())
    extra_data = {}
    if json_data.get("client_id"):
        extra_data["client_id"] = json_data["client_id"]
    if isinstance(json_data.get("extra_data"), dict):
        extra_data.update(json_data["extra_data"])
    valid = execution.validate_prompt(prompt_id, prompt, None)
    if asyncio.iscoroutine(valid):
        valid = await valid
    if not valid[0]:
        return web.json_response({"error": valid[1], "node_errors": valid[3]}, status=400)
    prompt_id, number = enqueue_comfy(prompt, extra_data, valid[2], prompt_id)
    return web.json_response(
        {"prompt_id": prompt_id, "number": number, "node_errors": valid[3] or {}}
    )


@PromptServer.instance.routes.post("/pencil/h3/prompt")
async def h3(request):
    json_data = await request.json()
    async with LOCK:
        try:
            await asyncio.wait_for(switch("h3"), timeout=12)
        except asyncio.TimeoutError:
            pass
        return await enqueue_prompt(json_data)


@PromptServer.instance.routes.post("/pencil/generate/cancel")
async def generate_cancel(request):
    body = {}
    try:
        body = await request.json()
    except Exception:
        body = {}
    family = str((body or {}).get("family") or "h3")
    prompt_id = str((body or {}).get("prompt_id") or "")
    await cancel_job(family, prompt_id)
    return web.json_response({"ok": True, "family": family, "holder": holder()})


NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
