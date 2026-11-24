from aiohttp import web
from server import PromptServer
import os, sys, folder_paths, asyncio

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pencil_gpu_guard import (
    holder as gpu_holder_name,
    diagnose,
    repair_backend,
    schedule_comfy_restart,
)

H3_HYBRID = "10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors"
H3_HYBRID_FALLBACKS = (
    "10Eros_Max_h3_TURBO-hybrid_beta5.safetensors",
    "10Eros_Max_h3_hybrid_beta5_int8.safetensors",
    "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
)
REF_FALLBACKS = (
    H3_HYBRID,
    "10Eros_Max_h3_TURBO-hybrid_beta5.safetensors",
    "10Eros_Max_h3_hybrid_beta5_int8.safetensors",
    "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
)
OFFICIAL_FL2V = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
OFFICIAL_REF2V = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
OFFICIAL_FL2V_LORA = "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"
OFFICIAL_REF2V_LORA = "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"


def first_present(category, names):
    for name in names:
        path = folder_paths.get_full_path(category, name)
        if path and os.path.isfile(path) and os.path.getsize(path) > 1024:
            return name, True
    return names[0], False


@PromptServer.instance.routes.get("/pencil/health")
async def pencil_health(request):
    video_name, video_ok = first_present("diffusion_models", (OFFICIAL_FL2V, H3_HYBRID) + H3_HYBRID_FALLBACKS)
    ref_name, ref_ok = first_present("diffusion_models", (OFFICIAL_REF2V,) + REF_FALLBACKS)
    files = {
        "video_model": ("diffusion_models", video_name, video_ok),
        "reference_model": ("diffusion_models", ref_name, ref_ok),
        "text_encoder": ("text_encoders", "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"),
        "video_vae": ("vae", "minimax_h3_video_vae_fp16.safetensors"),
        "audio_vae": ("vae", "minimax_h3_audio_vae_fp32.safetensors"),
        "video_turbo_lora": ("loras", OFFICIAL_FL2V_LORA),
        "reference_turbo_lora": ("loras", OFFICIAL_REF2V_LORA),
        "eros_max_turbo_hybrid_int8": ("diffusion_models", H3_HYBRID),
        "eros_max_hybrid_int8": ("diffusion_models", "10Eros_Max_h3_hybrid_beta5_int8.safetensors"),
    }
    models = {}
    for key, spec in files.items():
        if len(spec) == 3:
            category, name, available = spec
        else:
            category, name = spec
            path = folder_paths.get_full_path(category, name)
            available = bool(path and os.path.isfile(path) and os.path.getsize(path) > 1024)
        models[key] = {"name": name, "available": available}
    core = ("video_model", "reference_model", "text_encoder", "video_vae", "audio_vae")
    director = os.path.isdir(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "ComfyUI-MiniMaxH3-TimelineDirector")
    )
    status = diagnose()
    return web.json_response(
        {
            "service": "pencil-comfy-h3",
            "models": models,
            "ready": all(models[k]["available"] for k in core),
            "director": director,
            "gpu_holder": gpu_holder_name(),
            "worker": status["worker"],
            "stuck": status["stuck"],
            "queue": {
                "running": status["running"],
                "pending": status["pending"],
            },
        }
    )


@PromptServer.instance.routes.post("/pencil/repair")
async def pencil_repair(request):
    body = {}
    try:
        body = await request.json()
    except Exception:
        body = {}
    hard = bool((body or {}).get("hard"))
    result = await asyncio.to_thread(repair_backend, hard)
    if result.get("action") == "restarting":
        asyncio.get_event_loop().call_later(0.4, schedule_comfy_restart)
    return web.json_response(result)


NODE_CLASS_MAPPINGS = {}


@PromptServer.instance.routes.post("/pencil/validate")
async def pencil_validate(request):
    import execution, uuid

    data = await request.json()
    result = await execution.validate_prompt(str(uuid.uuid4()), data["prompt"], None)
    return web.json_response({"valid": result[0], "error": result[1], "node_errors": result[3]})
