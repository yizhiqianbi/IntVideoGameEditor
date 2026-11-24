#!/usr/bin/env bash
set -uo pipefail
key_path="${DRAMA_SSH_KEY:-${HOME}/.ssh/pencil_drama_gpu}"
# Dedicated remote key only permits forwarding to ComfyUI; no remote shell.
while true; do
  ssh -N -i "$key_path" -o IdentitiesOnly=yes -o BatchMode=yes \
    -L 127.0.0.1:6106:127.0.0.1:6006 -p 22141 \
    -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 \
    -o ExitOnForwardFailure=yes root@connect.westd.seetacloud.com
  result=$?
  if [ "$result" -eq 0 ]; then exit 0; fi
  echo 'GPU tunnel disconnected; reconnecting in 5 seconds.' >&2
  sleep 5
done
