#!/bin/bash
# Waits for jarvis-web to answer on 127.0.0.1:4100 (any auth response means it's up).
PORT="${PORT:-4100}"
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/auth/session" || true)
  case "$code" in
    200|401|403) echo "jarvis-web is up (HTTP $code)"; exit 0 ;;
  esac
  sleep 1
done
echo "jarvis-web did not come up. Last log lines:"
tail -n 20 "$HOME/Library/Logs/jarvis-web/jarvis-web.err.log" "$HOME/Library/Logs/jarvis-web/jarvis-web.log" 2>/dev/null
exit 1
