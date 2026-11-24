#!/usr/bin/env bash
set -euo pipefail
ROOT=/data/zrc/dyt/voice-mini01
cd "$ROOT"
# Bounded startup; never start inference against partially downloaded shards.
for i in $(seq 1 360); do
  if [[ -f dependencies.ready ]] && "$ROOT/venv/bin/python" - <<'PY'
import json
from pathlib import Path
p=Path('/data/zrc/dyt/voice-mini01/models/MiniCPM-o-4_5')
try:
    index=json.loads((p/'model.safetensors.index.json').read_text())
    ready=all((p/name).is_file() for name in set(index['weight_map'].values()))
    ready=ready and not any((p/'.cache').rglob('*.incomplete'))
except (OSError,ValueError):
    ready=False
raise SystemExit(0 if ready else 1)
PY
  then
    exec bash "$ROOT/start.sh"
  fi
  sleep 10
done
echo 'Dependencies or model not ready after one hour; inspect setup.log and download.log' >&2
exit 1
