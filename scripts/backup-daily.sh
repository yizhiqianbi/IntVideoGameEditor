#!/bin/bash
# Daily D1 backup for a xumeng account. Runs from launchd/cron.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export HOME="${XUMENG_WRANGLER_HOME:-$ROOT/.wrangler-home}"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-274d62c1f24b885b3dfe562cda5d60c1}"
EMAIL="${XUMENG_BACKUP_EMAIL:-super@xumengchat.top}"
KEEP="${XUMENG_BACKUP_KEEP:-14}"
LOG_DIR="$ROOT/output/xumeng/backups"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/backup.log"
echo "[$(date '+%F %T')] start $EMAIL" >> "$LOG"
if node scripts/backup-dzmm-user.mjs --email "$EMAIL" >> "$LOG" 2>&1; then
  echo "[$(date '+%F %T')] ok" >> "$LOG"
else
  echo "[$(date '+%F %T')] FAILED" >> "$LOG"
  exit 1
fi
# Retention: keep the newest $KEEP backup folders.
cd "$LOG_DIR"
ls -1dt */ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -I{} rm -rf "{}" 2>/dev/null || true
