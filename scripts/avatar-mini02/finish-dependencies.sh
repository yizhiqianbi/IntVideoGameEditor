#!/usr/bin/env bash
set -euo pipefail
cd /data/zrc/dyt/avatar-mini02
export PIP_CONFIG_FILE=/dev/null PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
unset PIP_EXTRA_INDEX_URL
# Use torch's matching NCCL package, not upstream's contradictory pin.
grep -v '^nvidia-nccl-cu12' upstream/requirements.txt > requirements.local.txt
venv/bin/pip install -r requirements.local.txt
venv/bin/python -c 'import torch,gradio; print(torch.__version__,gradio.__version__)'
touch dependencies.ready
