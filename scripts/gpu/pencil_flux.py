"""Local Flux.1-dev + Heartsync NSFW LoRA stills for the studio."""
import asyncio
import base64
import os
import time
import uuid
from aiohttp import web
from server import PromptServer
import folder_paths
import comfy.model_management

CKPT = "flux1-dev-fp8.safetensors"
LORA = "flux-nsfw-uncensored.safetensors"
NODE_CLASS_MAPPINGS = {}


def present(category, name):
    path = folder_paths.get_full_path(category, name)
    return bool(path and os.path.isfile(path) and os.path.getsize(path) > 1024)


def unload_others():
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
    try:
        comfy.model_management.unload_all_models()
        comfy.model_management.soft_empty_cache()
    except Exception:
        pass


def size_hw(size, aspect):
    if size == "2K":
        if aspect == "16:9":
            return 1920, 1088
        if aspect == "9:16":
            return 1088, 1920
        if aspect == "1:1":
            return 1536, 1536
        return 1920, 960
    if aspect == "16:9":
        return 1024, 576
    if aspect == "9:16":
        return 576, 1024
    return 1024, 1024


def save_reference(image):
    if not isinstance(image, str) or not image.strip():
        return None
    raw = image.strip()
    if raw.startswith("data:image/") and ";base64," in raw:
        payload = raw.split(";base64,", 1)[1]
        data = base64.b64decode(payload)
        ext = "png"
        if "image/jpeg" in raw:
            ext = "jpg"
        elif "image/webp" in raw:
            ext = "webp"
    elif raw.startswith("http://") or raw.startswith("https://"):
        import urllib.request

        with urllib.request.urlopen(raw, timeout=30) as resp:
            data = resp.read()
            ctype = resp.headers.get("content-type", "")
        ext = "jpg" if "jpeg" in ctype else "webp" if "webp" in ctype else "png"
    else:
        return None
    if len(data) > 20 * 1024 * 1024:
        raise ValueError("参考图不能超过 20MB")
    name = f"pencil-flux-{uuid.uuid4().hex}.{ext}"
    path = os.path.join(folder_paths.get_input_directory(), name)
    with open(path, "wb") as handle:
        handle.write(data)
    return name


def flux_graph(prompt, width, height, seed, steps, guidance, denoise, ref_name):
    latent = ["9", 0]
    graph = {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": CKPT},
        },
        "2": {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["1", 0],
                "clip": ["1", 1],
                "lora_name": LORA,
                "strength_model": 0.85,
                "strength_clip": 0.85,
            },
        },
        "3": {
            "class_type": "ModelSamplingFlux",
            "inputs": {
                "model": ["2", 0],
                "max_shift": 1.15,
                "base_shift": 0.5,
                "width": width,
                "height": height,
            },
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": ["2", 1]},
        },
        "5": {
            "class_type": "FluxGuidance",
            "inputs": {"conditioning": ["4", 0], "guidance": guidance},
        },
        "6": {
            "class_type": "BasicGuider",
            "inputs": {"model": ["3", 0], "conditioning": ["5", 0]},
        },
        "7": {
            "class_type": "KSamplerSelect",
            "inputs": {"sampler_name": "euler"},
        },
        "8": {
            "class_type": "RandomNoise",
            "inputs": {"noise_seed": seed},
        },
        "9": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "10": {
            "class_type": "BasicScheduler",
            "inputs": {
                "model": ["3", 0],
                "scheduler": "simple",
                "steps": steps,
                "denoise": denoise,
            },
        },
        "11": {
            "class_type": "SamplerCustomAdvanced",
            "inputs": {
                "noise": ["8", 0],
                "guider": ["6", 0],
                "sampler": ["7", 0],
                "sigmas": ["10", 0],
                "latent_image": latent,
            },
        },
        "12": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["11", 0], "vae": ["1", 2]},
        },
        "13": {
            "class_type": "SaveImage",
            "inputs": {"images": ["12", 0], "filename_prefix": "pencil-flux"},
        },
    }
    if ref_name:
        graph["14"] = {
            "class_type": "LoadImage",
            "inputs": {"image": ref_name},
        }
        graph["15"] = {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["14", 0], "vae": ["1", 2]},
        }
        graph["11"]["inputs"]["latent_image"] = ["15", 0]
    return graph


async def queue_and_wait(prompt, timeout=150):
    import execution

    prompt_id = str(uuid.uuid4())
    valid = await execution.validate_prompt(prompt_id, prompt, None)
    if not valid[0]:
        detail = valid[1]
        if isinstance(detail, dict):
            detail = detail.get("error") or detail.get("message") or str(detail)
        raise RuntimeError(detail or "Flux 工作流无效")
    server = PromptServer.instance
    extra = {"client_id": "pencil-flux"}
    number = getattr(server, "number", 0)
    server.number = number + 1
    server.prompt_queue.put((number, prompt_id, prompt, extra, valid[2], {}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        history = server.prompt_queue.get_history(prompt_id=prompt_id)
        item = history.get(prompt_id) if history else None
        if item:
            if item.get("status", {}).get("status_str") == "error":
                messages = item.get("status", {}).get("messages") or []
                err = next(
                    (
                        m[1].get("exception_message")
                        for m in messages
                        if isinstance(m, (list, tuple)) and m and m[0] == "execution_error"
                    ),
                    "Flux 推理失败",
                )
                raise RuntimeError(err)
            return item
        await asyncio.sleep(0.4)
    raise TimeoutError("Flux 生图超时")


def read_output(history):
    for output in (history.get("outputs") or {}).values():
        images = output.get("images") if isinstance(output, dict) else None
        if not images:
            continue
        file = images[0]
        folder = folder_paths.get_directory_by_type(file.get("type") or "output")
        path = os.path.join(folder, file.get("subfolder") or "", file["filename"])
        with open(path, "rb") as handle:
            data = handle.read()
        ext = os.path.splitext(file["filename"])[1].lower()
        mime = "image/jpeg" if ext in {".jpg", ".jpeg"} else "image/webp" if ext == ".webp" else "image/png"
        return mime, base64.b64encode(data).decode("ascii")
    raise RuntimeError("Flux 未写出图片")


@PromptServer.instance.routes.get("/pencil/flux/health")
async def flux_health(_request):
    ckpt = present("checkpoints", CKPT)
    lora = present("loras", LORA)
    return web.json_response(
        {
            "service": "pencil-flux-nsfw",
            "checkpoint": CKPT,
            "lora": LORA,
            "ready": ckpt and lora,
            "models": {
                "flux1_dev_fp8": {"name": CKPT, "available": ckpt},
                "nsfw_lora": {"name": LORA, "available": lora},
            },
        }
    )


@PromptServer.instance.routes.post("/pencil/flux/t2i")
async def flux_t2i(request):
    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        return web.json_response({"error": "提示词不能为空"}, status=400)
    if len(prompt) > 8000:
        return web.json_response({"error": "提示词过长"}, status=400)
    size = "2K" if body.get("size") == "2K" else "1K"
    aspect = body.get("aspect_ratio") or body.get("aspectRatio") or ""
    width, height = size_hw(size, aspect)
    steps = int(body.get("steps") or (28 if size == "2K" else 24))
    steps = max(8, min(steps, 40))
    guidance = float(body.get("guidance") or 3.5)
    seed = int(body.get("seed") or uuid.uuid4().int % (2**48))
    ref = None
    try:
        ref = save_reference(body.get("image"))
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)
    denoise = 0.72 if ref else 1.0
    import os
    import sys

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from pencil_gpu_guard import LOCK, switch

    async with LOCK:
        await switch("flux")
        graph = flux_graph(prompt, width, height, seed, steps, guidance, denoise, ref)
        try:
            history = await queue_and_wait(graph)
            mime, b64 = read_output(history)
        except Exception as error:
            return web.json_response({"error": str(error)}, status=502)
        return web.json_response({"mimeType": mime, "b64Json": b64, "width": width, "height": height})
