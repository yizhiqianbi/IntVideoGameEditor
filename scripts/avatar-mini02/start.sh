#!/usr/bin/env bash
set -euo pipefail
ROOT=/data/zrc/dyt/avatar-mini02
cd "$ROOT/upstream"
export CUDA_VISIBLE_DEVICES=${AVATAR_GPU:-4} HF_ENDPOINT=https://hf-mirror.com
export HF_HOME="$ROOT/cache/huggingface" PYTHONPATH="$ROOT/upstream"
export GRADIO_ANALYTICS_ENABLED=False
export GRADIO_TEMP_DIR="$ROOT/cache/gradio"
mkdir -p "$GRADIO_TEMP_DIR"
exec "$ROOT/venv/bin/python" -u "$ROOT/app.py"
