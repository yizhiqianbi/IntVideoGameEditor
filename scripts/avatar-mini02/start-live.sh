#!/usr/bin/env bash
set -euo pipefail
ROOT=/data/zrc/dyt/avatar-mini02
cd "$ROOT/live"
export GRADIO_TEMP_DIR="$ROOT/cache/gradio" GRADIO_ANALYTICS_ENABLED=False
exec "$ROOT/venv/bin/python" -u -m uvicorn server:app --host 127.0.0.1 --port 8027 --ws-ping-interval 20 --ws-ping-timeout 120
