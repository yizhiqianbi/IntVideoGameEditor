#!/usr/bin/env bash
set -euo pipefail
# Password stays in your SSH prompt / keychain, never in this repository.
exec ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L 127.0.0.1:8016:127.0.0.1:8016 -p 2223 medteam@119.145.35.48
