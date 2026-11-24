#!/usr/bin/env bash
# Boot ComfyUI (:6006) and 10Eros (:6008) on the current AutoDL box,
# then probe local + public health endpoints.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.local"
  set +a
fi

HOST="${DRAMA_GPU_SSH_HOST:?set DRAMA_GPU_SSH_HOST in .env.local}"
PORT="${DRAMA_GPU_SSH_PORT:?set DRAMA_GPU_SSH_PORT in .env.local}"
USER="${DRAMA_GPU_SSH_USER:-root}"
COMFY_URL="${DRAMA_COMFY_URL:-}"
LTX_URL="${DRAMA_LTX_URL:-}"

if [[ -z "${DRAMA_GPU_SSH_PASS:-}" && -z "${SSHPASS:-}" ]]; then
  echo "Set DRAMA_GPU_SSH_PASS or SSHPASS (AutoDL 控制台密码，不要写进 git)。" >&2
  exit 1
fi
export SSHPASS="${SSHPASS:-$DRAMA_GPU_SSH_PASS}"

SSH=(sshpass -e ssh -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1 -p "$PORT" "$USER@$HOST")
SCP=(sshpass -e scp -o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password,keyboard-interactive -o PubkeyAuthentication=no -o NumberOfPasswordPrompts=1 -P "$PORT")

echo "== sync custom nodes =="
"${SCP[@]}" \
  "$ROOT/scripts/gpu/pencil_health.py" \
  "$ROOT/scripts/gpu/pencil_ltx_bridge.py" \
  "$ROOT/scripts/gpu/pencil_gpu_guard.py" \
  "$ROOT/scripts/gpu/pencil_reference_media.py" \
  "$ROOT/scripts/gpu/pencil_long_video.py" \
  "$ROOT/scripts/gpu/pencil_archives.py" \
  "$ROOT/scripts/gpu/pencil_flux.py" \
  "$ROOT/scripts/gpu/pencil_input_image.py" \
  "$USER@$HOST:/root/ComfyUI/custom_nodes/"
"${SCP[@]}" \
  "$ROOT/scripts/gpu/pencil_pinkcherry.py" \
  "$ROOT/scripts/gpu/pencil_sulphur_t2v.py" \
  "$USER@$HOST:/root/autodl-tmp/10Eros-backend/"

echo "== start backends =="
"${SSH[@]}" "bash -s" <<'EOF'
set +e
python_bin=/root/miniconda3/bin/python
mkdir -p /root/autodl-tmp/pencil-archives
chmod 700 /root/autodl-tmp/pencil-archives
if [ -f /root/.pencil-archive-token ]; then chmod 600 /root/.pencil-archive-token; fi
rm -f /root/ComfyUI/custom_nodes/pencil_auk_bridge.py /root/autodl-tmp/start_auk.sh
pkill -f "uvicorn pencil_auk:app" >/dev/null 2>&1 || true
plugin=/root/ComfyUI/custom_nodes/ComfyUI-MiniMaxH3-TimelineDirector
if [ ! -d "$plugin/.git" ]; then
  echo "cloning TimelineDirector"
  git clone --depth 1 https://github.com/Songssx/ComfyUI-MiniMaxH3-TimelineDirector.git "$plugin" || echo "TimelineDirector clone failed"
fi

$python_bin -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:6008/health', timeout=2)" >/dev/null 2>&1
eros=$?
$python_bin -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:6006/pencil/health', timeout=2)" >/dev/null 2>&1
comfy=$?
if [ "$eros" -ne 0 ]; then
  echo "starting 10Eros :6008"
  cd /root/autodl-tmp/10Eros-backend
  nohup ./start.sh >> /root/pencil-10eros.log 2>&1 < /dev/null &
fi
if [ "$comfy" -ne 0 ]; then
  echo "starting ComfyUI :6006"
  cd /root/ComfyUI
  nohup $python_bin main.py --listen 0.0.0.0 --port 6006 --enable-cors-header --preview-method latent2rgb --preview-size 256 >> /root/pencil-comfyui.log 2>&1 < /dev/null &
fi

for i in $(seq 1 40); do
  c=0; e=0
  curl -sf -m 3 http://127.0.0.1:6006/pencil/health >/dev/null 2>&1 && c=1
  curl -sf -m 3 http://127.0.0.1:6008/health >/dev/null 2>&1 && e=1
  echo "wait $i comfy=$c eros=$e"
  if [ "$c$e" = "11" ]; then break; fi
  sleep 3
done

echo "=== local comfy ==="
curl -sS -m 8 http://127.0.0.1:6006/pencil/health
echo
echo "=== local ltx ==="
curl -sS -m 8 http://127.0.0.1:6006/pencil/ltx/health
echo
echo "=== local eros ==="
curl -sS -m 8 http://127.0.0.1:6008/health
echo
EOF

if [[ -n "$COMFY_URL" ]]; then
  echo "== public ComfyUI $COMFY_URL =="
  curl -sS -m 20 "$COMFY_URL/pencil/health"; echo
  curl -sS -m 20 -o /dev/null -w "ltx HTTP %{http_code}\n" "$COMFY_URL/pencil/ltx/health"
fi
if [[ -n "$LTX_URL" ]]; then
  echo "== public 10Eros $LTX_URL =="
  curl -sS -m 20 "$LTX_URL/health"; echo
fi
echo "boot done"
