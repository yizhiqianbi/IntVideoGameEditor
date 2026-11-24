#!/usr/bin/env bash
set -euo pipefail
ROOT=/data/zrc/dyt/avatar-mini02
cd "$ROOT/live"
exec "$ROOT/venv/bin/python" -m uvicorn public_gateway:app --host 127.0.0.1 --port 8028 --ws-ping-interval 20 --ws-ping-timeout 120
