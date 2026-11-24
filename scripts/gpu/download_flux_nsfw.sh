#!/usr/bin/env bash
# Download FLUX.1-dev fp8 (Comfy all-in-one) + Heartsync NSFW LoRA onto AutoDL.
set -euo pipefail
DIR="${FLUX_MODEL_DIR:-/root/autodl-tmp/pencil-models/flux}"
COMFY="${COMFY_DIR:-/root/ComfyUI}"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
PY="${PYTHON_BIN:-/root/miniconda3/bin/python}"
mkdir -p "$DIR" "$COMFY/models/checkpoints" "$COMFY/models/loras"

"$PY" - <<'PY'
import os
from huggingface_hub import hf_hub_download

dest = os.environ.get("FLUX_MODEL_DIR", "/root/autodl-tmp/pencil-models/flux")
os.makedirs(dest, exist_ok=True)
print("HF_ENDPOINT", os.environ.get("HF_ENDPOINT"), flush=True)
ckpt = hf_hub_download(
    "Comfy-Org/flux1-dev",
    "flux1-dev-fp8.safetensors",
    local_dir=dest,
)
lora = hf_hub_download(
    "Heartsync/Flux-NSFW-uncensored",
    "lora.safetensors",
    local_dir=dest,
)
print("ckpt", ckpt, os.path.getsize(ckpt), flush=True)
print("lora", lora, os.path.getsize(lora), flush=True)
PY

ln -sfn "$DIR/flux1-dev-fp8.safetensors" "$COMFY/models/checkpoints/flux1-dev-fp8.safetensors"
ln -sfn "$DIR/lora.safetensors" "$COMFY/models/loras/flux-nsfw-uncensored.safetensors"
ls -lh "$COMFY/models/checkpoints/flux1-dev-fp8.safetensors" "$COMFY/models/loras/flux-nsfw-uncensored.safetensors"
echo "flux nsfw weights ready"
