#!/usr/bin/env bash
set -euo pipefail
ROOT=/data/zrc/dyt/voice-mini01
cd "$ROOT/upstream"
export CUDA_VISIBLE_DEVICES=5
export HF_ENDPOINT=https://hf-mirror.com
export HF_HOME="$ROOT/cache/huggingface"
export XDG_CACHE_HOME="$ROOT/cache"
export PYTHONPATH=.
# Deployment overrides are local, non-secret performance settings.
if [[ -f "$ROOT/performance.env" ]]; then
  set -a
  source "$ROOT/performance.env"
  set +a
fi
export OMP_NUM_THREADS=${VOICE_THREADS:-28}
export MKL_NUM_THREADS=$OMP_NUM_THREADS
export OPENBLAS_NUM_THREADS=1
export MINI01_PAD_AUDIO=${VOICE_PAD_AUDIO:-1}
export TORCHINDUCTOR_CACHE_DIR="$ROOT/cache/torchinductor"
export TORCHINDUCTOR_COMPILE_THREADS=4
PY="$ROOT/venv/bin/python"
mkdir -p "$ROOT/logs"
exec 9>"$ROOT/service.lock"
# The previous worker may retain this inherited lock while releasing CUDA.
flock -w 60 9 || { echo 'Voice service already managed after 60s'; exit 1; }
"$PY" - <<'PY'
import json,os
from pathlib import Path
root=Path('/data/zrc/dyt/voice-mini01')
model=root/'models/MiniCPM-o-4_5'
index=json.loads((model/'model.safetensors.index.json').read_text())
missing=[name for name in set(index['weight_map'].values()) if not (model/name).is_file()]
if missing: raise SystemExit(f'Model download incomplete: {missing}')
Path('config.json').write_text(json.dumps({
 'model': {'model_path':str(model),'attn_implementation':'sdpa'},
 'recording': {'enabled':False},
 'service': {'gateway_port':8016,'worker_base_port':22410,'compile':os.environ.get('VOICE_COMPILE','0')=='1'},
 'audio': {'playback_delay_ms':200}
},indent=2))
PY
pids=()
cleanup() { if ((${#pids[@]})); then kill "${pids[@]}" 2>/dev/null || true; fi; }
trap cleanup EXIT
trap 'exit 0' TERM INT
"$PY" -m py_backend.server --host 127.0.0.1 --port 22510 --gpu-id 0 --model-path "$ROOT/models/MiniCPM-o-4_5" >"$ROOT/logs/backend.log" 2>&1 &
pids+=($!)
ready=0
for i in $(seq 1 300); do
  kill -0 "${pids[0]}" || { tail -n 40 "$ROOT/logs/backend.log"; exit 1; }
  if curl -sf http://127.0.0.1:22510/health | "$PY" -c 'import sys,json;sys.exit(json.load(sys.stdin).get("status")!="ready")' 2>/dev/null; then ready=1; break; fi
  sleep 2
done
[[ "$ready" == 1 ]] || { echo 'Model startup timed out'; exit 1; }
"$PY" worker.py --host 127.0.0.1 --port 22410 --gpu-id 0 --backend-server-url http://127.0.0.1:22510 >"$ROOT/logs/worker.log" 2>&1 &
pids+=($!)
"$PY" gateway.py --host 127.0.0.1 --port 8016 --internal-port 8017 --http --lang zh >"$ROOT/logs/gateway.log" 2>&1 &
pids+=($!)
registered=0
for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:22410/health >/dev/null && curl -sf -X PUT -H 'Content-Type: application/json' --data '{"endpoint":"127.0.0.1:22410","gpu_group":"gpu-5"}' http://127.0.0.1:8017/internal/workers/voice-mini01; then registered=1; break; fi
  sleep 2
done
[[ "$registered" == 1 ]] || { echo 'Worker registration failed'; exit 1; }
echo 'Voice service ready on loopback port 8016'
while true; do
  for pid in "${pids[@]}"; do kill -0 "$pid" || exit 1; done
  sleep 5
done
