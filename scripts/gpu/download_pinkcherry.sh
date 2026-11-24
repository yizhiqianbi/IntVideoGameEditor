#!/usr/bin/env bash
# Download PinkCherry LTX-2.3 v1.8 onto the AutoDL data disk, same pattern as 10Eros.
# GGUF is what ComfyUI GGUFLoaderKJ loads. DistilledPipeline (port 6008) needs the bf16 monolith.
set -euo pipefail
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
HF="${HF_BIN:-/root/miniconda3/bin/hf}"
DEST="${PINKCHERRY_DIR:-/root/autodl-tmp/10Eros-backend/checkpoints/pinkcherry-v1.8}"
UNET="${COMFY_UNET:-/root/ComfyUI/models/unet}"
DIFFUSION="${COMFY_DIFFUSION:-/root/ComfyUI/models/diffusion_models}"
LOG="${PINKCHERRY_LOG:-/root/autodl-tmp/10Eros-backend/logs/pinkcherry-download.log}"
mkdir -p "$DEST" "$(dirname "$LOG")" "$UNET" "$DIFFUSION"

gguf="v1.8/PinkCherry_FineTune_Q8_0_v1_8_LTX23.gguf"
bf16="v1.8/PinkCherry_FineTune_bf16_v1_8_LTX23.safetensors"

download() {
  local uri="$1"
  echo "[pinkcherry] hf download $uri" | tee -a "$LOG"
  "$HF" download "hf://SexGod1979/PinkCherry_NSFW_LTX23/${uri}" --local-dir "$DEST" | tee -a "$LOG"
}

download "$gguf"
if [[ "${PINKCHERRY_SKIP_BF16:-0}" != "1" ]]; then
  download "$bf16"
fi

gguf_path="$DEST/$gguf"
if [[ -f "$gguf_path" ]]; then
  ln -sfn "$gguf_path" "$UNET/PinkCherry_FineTune_Q8_0_v1_8_LTX23.gguf"
  ln -sfn "$gguf_path" "$DIFFUSION/PinkCherry_FineTune_Q8_0_v1_8_LTX23.gguf"
  echo "[pinkcherry] linked GGUF into ComfyUI unet/ and diffusion_models/" | tee -a "$LOG"
fi

echo "[pinkcherry] done"
ls -lh "$DEST/v1.8" | tee -a "$LOG"
