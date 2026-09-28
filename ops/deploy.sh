#!/bin/bash
# Pull the latest code, rebuild, and restart the service.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
git pull --ff-only
npm install --no-audit --no-fund
npm run build
launchctl kickstart -k "gui/$(id -u)/com.jarvisbykush.web"
"$REPO/ops/wait-for-server.sh"
