#!/bin/bash
# Checks the deployment against the security / ops acceptance items (CLAUDE.md §11).
# Usage: ops/verify.sh [hostname]   (default jarvisbykush.us)
REPO="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${1:-jarvisbykush.us}"
ENV_FILE="$REPO/server/.env"
LABEL="com.jarvisbykush.web"
fails=0
pass() { printf "  \033[32mPASS\033[0m %s\n" "$1"; }
fail() { printf "  \033[31mFAIL\033[0m %s\n" "$1"; fails=$((fails + 1)); }
warn() { printf "  \033[33mWARN\033[0m %s\n" "$1"; }
envval() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//"; }

echo "Service"
if launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -q "state = running"; then
  pass "launchd agent $LABEL is running"
else
  fail "launchd agent $LABEL is not running (ops/install-service.sh)"
fi

echo "Ports only on loopback"
for port in 4100 8642; do
  listeners=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $9}' | sort -u)
  if [ -z "$listeners" ]; then
    warn "nothing listening on $port"
  elif echo "$listeners" | grep -vqE '^(127\.0\.0\.1|\[::1\]):'; then
    fail "port $port is reachable beyond this Mac: $(echo $listeners)"
  else
    pass "port $port listens on loopback only"
  fi
done

echo "Production settings"
[ "$(envval NODE_ENV "$ENV_FILE")" = "production" ] && pass "NODE_ENV=production" || fail "NODE_ENV is not production"
[ "$(envval DEV_BYPASS_ACCESS "$ENV_FILE")" != "true" ] && pass "DEV_BYPASS_ACCESS is off" || fail "DEV_BYPASS_ACCESS=true"
for k in DASHBOARD_PASSPHRASE_HASH SESSION_SECRET CF_ACCESS_TEAM_DOMAIN CF_ACCESS_AUD HERMES_API_KEY; do
  [ -n "$(envval $k "$ENV_FILE")" ] && pass "$k is set" || fail "$k is empty"
done
if [ "$(uname)" = Darwin ]; then perm=$(stat -f "%Lp" "$ENV_FILE"); else perm=$(stat -c "%a" "$ENV_FILE"); fi
[ "$perm" = "600" ] && pass "server/.env is owner-only (600)" || warn "server/.env permissions are $perm (chmod 600 server/.env)"

echo "No secrets in the web bundle"
if [ ! -d "$REPO/web/dist" ]; then
  fail "web/dist missing (npm run build)"
else
  leaked=0
  for k in HERMES_API_KEY ELEVENLABS_API_KEY SESSION_SECRET; do
    v="$(envval $k "$ENV_FILE")"
    if [ -n "$v" ] && grep -rqF -- "$v" "$REPO/web/dist"; then fail "$k value found in web/dist"; leaked=1; fi
  done
  hk="$(envval API_SERVER_KEY "$HOME/.hermes/.env")"
  if [ -n "$hk" ] && grep -rqF -- "$hk" "$REPO/web/dist"; then fail "Hermes API_SERVER_KEY found in web/dist"; leaked=1; fi
  [ $leaked = 0 ] && pass "no API keys or secrets in web/dist"
fi

echo "Cloudflare Access enforced at the origin"
code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4100/)
[ "$code" = "403" ] && pass "direct request without an Access token is refused (403)" || fail "direct request returned $code (expected 403)"

echo "Public URL"
headers=$(curl -s -o /dev/null -D - --max-time 15 "https://$HOST/" || true)
status=$(echo "$headers" | awk 'NR==1 {print $2}')
location=$(echo "$headers" | grep -i '^location:' | tr -d '\r')
if echo "$location" | grep -q "cloudflareaccess.com"; then
  pass "https://$HOST redirects to the Cloudflare Access login"
elif [ -z "$status" ]; then
  fail "https://$HOST is unreachable (DNS / tunnel?)"
else
  fail "https://$HOST returned $status without an Access redirect: the app may be public!"
fi

echo "Mac mini stays up"
pmset -g 2>/dev/null | awk '$1=="sleep" {print $2}' | grep -qx 0 && pass "system sleep disabled" || warn "system sleep is on (sudo pmset -a sleep 0)"
pmset -g 2>/dev/null | awk '$1=="autorestart" {print $2}' | grep -qx 1 && pass "restarts after power failure" || warn "auto-restart after power failure is off (sudo pmset -a autorestart 1)"

echo
[ $fails = 0 ] && echo "All checks passed." || echo "$fails check(s) failed."
exit $fails
