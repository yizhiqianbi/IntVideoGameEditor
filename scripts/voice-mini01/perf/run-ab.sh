#!/usr/bin/env bash
set -euo pipefail
ROOT=/data/zrc/dyt/voice-mini01
mkdir -p "$ROOT/perf"
cd "$ROOT/upstream"
# Abort before touching the service if a browser session is using it.
"$ROOT/venv/bin/python" - <<'PY'
import urllib.request,json
assert not json.load(urllib.request.urlopen('http://127.0.0.1:8027/health'))['active'], 'User session active'
PY
restore() {
  nohup bash "$ROOT/start.sh" </dev/null >"$ROOT/service.log" 2>&1 &
  echo $! >"$ROOT/service.pid"
}
kill "$(cat "$ROOT/service.pid")"
trap restore EXIT
sleep 5
export CUDA_VISIBLE_DEVICES=5 PYTHONPATH="$ROOT/upstream" HF_ENDPOINT=https://hf-mirror.com
export HF_HOME="$ROOT/cache/huggingface" XDG_CACHE_HOME="$ROOT/cache"
export TORCHINDUCTOR_CACHE_DIR="$ROOT/cache/torchinductor" TORCHINDUCTOR_COMPILE_THREADS=4
# Bounded test; restore the ordinary service even on compile failure/timeout.
timeout --kill-after=20 600 "$ROOT/venv/bin/python" -u "$ROOT/perf/optimize.py" >"$ROOT/perf/ab.log" 2>&1
