#!/usr/bin/env bash
set -euo pipefail
ROOT=/data/zrc/dyt/voice-mini01
cd "$ROOT"
export PIP_CONFIG_FILE=/dev/null
export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
unset PIP_EXTRA_INDEX_URL
export HF_ENDPOINT=https://hf-mirror.com
export HF_HOME="$ROOT/cache/huggingface"
export XDG_CACHE_HOME="$ROOT/cache"
if [ ! -d upstream/.git ]; then git clone --depth 1 https://github.com/OpenBMB/MiniCPM-o-Demo.git upstream; fi
/home/medteam/miniconda3/envs/py312/bin/python -m venv "$ROOT/venv"
"$ROOT/venv/bin/pip" install --upgrade pip
"$ROOT/venv/bin/pip" install huggingface_hub
nohup "$ROOT/venv/bin/hf" download openbmb/MiniCPM-o-4_5 --local-dir "$ROOT/models/MiniCPM-o-4_5" > "$ROOT/download.log" 2>&1 < /dev/null &
echo $! > "$ROOT/download.pid"
"$ROOT/venv/bin/pip" install torch==2.8.0 torchaudio==2.8.0
bash "$ROOT/finish-dependencies.sh"
