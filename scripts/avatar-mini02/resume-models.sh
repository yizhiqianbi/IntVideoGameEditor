#!/usr/bin/env bash
set -euo pipefail
cd /data/zrc/dyt/avatar-mini02
export HF_ENDPOINT=https://hf-mirror.com
export HF_HOME="$PWD/cache/huggingface"
venv/bin/python - <<'PY'
from pathlib import Path
p=Path('upstream/models/SoulX-FlashHead-1_3B')
target=p/'Model_Lite/diffusion_pytorch_model.safetensors'
parts=list((p/'.cache/huggingface/download/Model_Lite').glob('*.incomplete'))
if not target.exists() and len(parts)==1:
    parts[0].rename(target)
PY
aria2c --continue=true --max-connection-per-server=8 --split=8 --min-split-size=16M --file-allocation=none --summary-interval=30 --console-log-level=warn --dir=upstream/models/SoulX-FlashHead-1_3B/Model_Lite --out=diffusion_pytorch_model.safetensors 'https://hf-mirror.com/Soul-AILab/SoulX-FlashHead-1_3B/resolve/main/Model_Lite/diffusion_pytorch_model.safetensors'
echo 'aaf1cde6e80ca23f740aae236c47954249f65b151db133cc0f77d3a138ccdf6e  upstream/models/SoulX-FlashHead-1_3B/Model_Lite/diffusion_pytorch_model.safetensors' | sha256sum -c -
venv/bin/hf download facebook/wav2vec2-base-960h --include '*.json' pytorch_model.bin --local-dir upstream/models/wav2vec2-base-960h
touch models.ready
