#!/bin/bash
# Installs (or reinstalls) jarvis-web as a launchd user agent: starts at login, restarts
# if it exits, logs to ~/Library/Logs/jarvis-web/. Safe to run again.
set -euo pipefail

LABEL="com.jarvisbykush.web"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then echo "node not found on PATH"; exit 1; fi
if ! "$NODE" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>20||(a===20&&b>=12)?0:1)'; then
  echo "Node 20.12+ required (found $("$NODE" -v))"; exit 1
fi
if [ ! -f "$REPO/server/dist/index.js" ]; then
  echo "No build yet. Run: cd $REPO && npm install && npm run build"; exit 1
fi
if [ ! -f "$REPO/server/.env" ]; then
  echo "Missing $REPO/server/.env (copy server/.env.example and fill it in)"; exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/jarvis-web"
sed -e "s|__NODE__|$NODE|g" -e "s|__NODE_DIR__|$(dirname "$NODE")|g" \
    -e "s|__REPO__|$REPO|g" -e "s|__HOME__|$HOME|g" \
    "$REPO/ops/$LABEL.plist.template" > "$PLIST"
plutil -lint "$PLIST" >/dev/null

# Stop a copy started by hand (nohup npm start) so the port is free.
pkill -f "node dist/index.js" 2>/dev/null || true
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"

"$REPO/ops/wait-for-server.sh"
echo "Installed $LABEL. Logs: ~/Library/Logs/jarvis-web/"
