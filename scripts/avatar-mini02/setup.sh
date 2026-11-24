#!/usr/bin/env bash
set -euo pipefail
ROOT=/data/zrc/dyt/avatar-mini02
cd "$ROOT"
export PIP_CONFIG_FILE=/dev/null PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple HF_ENDPOINT=https://hf-mirror.com
export HF_HOME="$ROOT/cache/huggingface"
unset PIP_EXTRA_INDEX_URL
[ -d upstream/.git ] || git clone --depth 1 https://github.com/Soul-AILab/SoulX-FlashHead.git upstream
/home/medteam/miniconda3/envs/comfyui/bin/python -m venv "$ROOT/venv"
venv/bin/pip install --upgrade pip
venv/bin/pip install huggingface_hub
nohup bash -c 'set -e; venv/bin/hf download Soul-AILab/SoulX-FlashHead-1_3B --local-dir upstream/models/SoulX-FlashHead-1_3B; venv/bin/hf download facebook/wav2vec2-base-960h --include "*.json" "pytorch_model.bin" --local-dir upstream/models/wav2vec2-base-960h; touch models.ready' >download.log 2>&1 < /dev/null &
echo $! > download.pid
venv/bin/pip install torch==2.7.1 torchvision==0.22.1
bash finish-dependencies.sh
