#!/bin/bash
# Install the daily 04:00 backup job (macOS launchd). Safe to re-run.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLIST="$ROOT/infra/launchd/com.xumeng.backup.plist"
TARGET="$HOME/Library/LaunchAgents/com.xumeng.backup.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$PLIST" "$TARGET"
launchctl bootout "gui/$(id -u)/com.xumeng.backup" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"
echo "installed: $TARGET"
launchctl print "gui/$(id -u)/com.xumeng.backup" | grep -E 'state|program|path' | head -5 || true
