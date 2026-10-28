#!/bin/bash
# boot-restored.sh   Boots the API and web build restored from cache, probes both, stops both.
# Env: DATABASE_URL (disposable test database), LOGDIR (folder for server logs). Run from the repository root.
set -u
api_url=http://127.0.0.1:4100; web_url=http://127.0.0.1:3000
env NODE_ENV=production AUTH_ISSUER=https://identity.example.invalid AUTH_AUDIENCE=acme-api AUTH_JWKS_URL=https://identity.example.invalid/jwks PORT=4100 \
  node apps/api/dist/main.js > "$LOGDIR/api-boot.stdout" 2> "$LOGDIR/api-boot.stderr" &
api_pid=$!
env NODE_ENV=production API_BASE_URL="$api_url" AUTH_MODE=external-cookie HOSTNAME=127.0.0.1 PORT=3000 \
  node apps/web/scripts/start.mjs > "$LOGDIR/web-boot.stdout" 2> "$LOGDIR/web-boot.stderr" &
web_pid=$!
trap 'kill "$api_pid" "$web_pid" 2>/dev/null; wait "$api_pid" "$web_pid" 2>/dev/null; true' EXIT
for _ in $(seq 1 120); do curl -fsS -o /dev/null "$api_url/health/live" 2>/dev/null && break; sleep 0.5; done
for _ in $(seq 1 120); do [ "$(curl -sS -o /dev/null -w '%{http_code}' "$web_url/" 2>/dev/null)" != 000 ] && break; sleep 0.5; done
echo "--- curl -fsS $api_url/health/live"
curl -fsS -w '\nAPI live status: %{http_code}\n' "$api_url/health/live"
echo "--- curl $web_url/"
curl -sS -o /dev/null -w 'WEB root status: %{http_code} redirect: %{redirect_url}\n' "$web_url/"
echo "--- listeners"
ss -ltnp 2>/dev/null | grep -E ':(3000|4100)\b' || true
