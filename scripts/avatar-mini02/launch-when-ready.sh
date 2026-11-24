#!/usr/bin/env bash
set -euo pipefail
cd /data/zrc/dyt/avatar-mini02
exec 9>service.lock
flock -n 9 || exit 1
for i in $(seq 1 360); do
  if [[ -f dependencies.ready && -f models.ready ]]; then
    exec bash start.sh
  fi
  sleep 10
done
echo 'Installation timed out; check setup.log and download.log' >&2
exit 1
