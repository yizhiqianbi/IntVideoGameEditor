#!/usr/bin/env bash
set -euo pipefail
ROOT=/data/zrc/dyt/voice-mini01
cd "$ROOT"
export PIP_CONFIG_FILE=/dev/null
export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
unset PIP_EXTRA_INDEX_URL
mkdir -p packages
venv/bin/pip download --no-deps minicpmo-utils==1.0.6 -d packages
tar -xf packages/minicpmo_utils-1.0.6.tar.gz -C packages
# Upstream demo requires librosa>=0.10.2 but utils pins 0.9.0.
# Keep inference code intact; patch the vendored dependency metadata only.
venv/bin/python - <<'PY'
from pathlib import Path
p=Path('packages/minicpmo_utils-1.0.6/pyproject.toml')
p.write_text(p.read_text().replace('librosa==0.9.0','librosa==0.11.0'))
lines=Path('upstream/requirements.txt').read_text().splitlines()
Path('requirements.local.txt').write_text('\n'.join(x for x in lines if not x.startswith('minicpmo-utils'))+'\nnumpy==2.2.6\n')
PY
venv/bin/pip install './packages/minicpmo_utils-1.0.6[all]' -r requirements.local.txt
venv/bin/python - <<'PY'
import subprocess
import torch, transformers, decord
result=subprocess.run(['venv/bin/pip','check'],capture_output=True,text=True)
print(result.stdout,result.stderr)
# decord's published py3-none wheel contains stale cp36 WHEEL metadata.
# Its ctypes library import is checked above; fail for any other conflict.
warnings=[line for line in result.stdout.splitlines() if line.strip()]
if result.returncode and warnings != ['decord 0.6.0 is not supported on this platform']:
    raise SystemExit(result.returncode)
print(torch.__version__,transformers.__version__,decord.__version__)
PY
touch dependencies.ready
