#!/usr/bin/env bash
# Download TenStrip/10Eros-Max beta5 H3 hybrids onto the AutoDL data disk.
# Full bf16 files are ~40GB each; 5090 32GB actually runs the int8 / w4a8 builds.
set -euo pipefail
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
HF="${HF_BIN:-/root/miniconda3/bin/hf}"
DEST="${EROS_MAX_DIR:-/root/autodl-tmp/10Eros-Max}"
DIFFUSION="${COMFY_DIFFUSION:-/root/ComfyUI/models/diffusion_models}"
UNET="${COMFY_UNET:-/root/ComfyUI/models/unet}"
LOG="${EROS_MAX_LOG:-/root/autodl-tmp/10Eros-backend/logs/10eros-max-beta5-download.log}"
mkdir -p "$DEST" "$(dirname "$LOG")" "$DIFFUSION" "$UNET"

files=(
  10Eros_Max_h3_TURBO-hybrid_beta5_int8.safetensors
  10Eros_Max_h3_hybrid_beta5_int8.safetensors
  10Eros_Max_h3_TURBO-hybrid_beta5_w4a8_14gb_optimized.safetensors
  10Eros_Max_h3_hybrid_beta5_w4a8_14gb_optimized.safetensors
  10Eros_Max_h3_TURBO-hybrid_beta5.safetensors
  10Eros_Max_h3_hybrid_beta5.safetensors
)

need_gb() {
  case "$1" in
    *w4a8*) echo 15 ;;
    *int8*) echo 22 ;;
    *) echo 41 ;;
  esac
}

avail_gb() {
  df -BG --output=avail "$DEST" | awk 'NR==2 {gsub(/G/,""); print $1}'
}

download_one() {
  local name="$1"
  local path="$DEST/$name"
  if [[ -f "$path" && $(stat -c%s "$path") -gt 1000000000 ]]; then
    echo "[10eros-max] already have $name ($(du -h "$path" | awk '{print $1}'))" | tee -a "$LOG"
    return 0
  fi
  local need avail
  need=$(need_gb "$name")
  avail=$(avail_gb)
  if [[ "$avail" -lt "$need" ]]; then
    echo "[10eros-max] skip $name: need ${need}G, only ${avail}G free" | tee -a "$LOG"
    return 0
  fi
  echo "[10eros-max] hf download $name (${need}G, ${avail}G free)" | tee -a "$LOG"
  "$HF" download TenStrip/10Eros-Max "$name" --local-dir "$DEST" | tee -a "$LOG"
}

link_one() {
  local name="$1"
  local path="$DEST/$name"
  if [[ -f "$path" ]]; then
    ln -sfn "$path" "$DIFFUSION/$name"
    ln -sfn "$path" "$UNET/$name"
    echo "[10eros-max] linked $name into ComfyUI" | tee -a "$LOG"
  fi
}

echo "[10eros-max] start $(date -Is)" | tee -a "$LOG"
for name in "${files[@]}"; do
  download_one "$name"
  link_one "$name"
done
echo "[10eros-max] done $(date -Is)" | tee -a "$LOG"
ls -lh "$DEST" | tee -a "$LOG"
df -h "$DEST" | tee -a "$LOG"
