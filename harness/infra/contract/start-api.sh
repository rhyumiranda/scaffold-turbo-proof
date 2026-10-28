#!/bin/bash
# start-api.sh LOGDIR   Starts the compiled API in the background (pid in LOGDIR/api.pid) and waits until it is ready.
# Env: DATABASE_URL. The API accepts a plain-http IdP on loopback only with NODE_ENV=test (apps/api/docs/environment.md).
set -u
cd "$WS/apps/api" || exit 1
env NODE_ENV=test AUTH_ISSUER=http://localhost:8080/realms/acme AUTH_AUDIENCE=acme-api \
  AUTH_JWKS_URL=http://localhost:8080/realms/acme/protocol/openid-connect/certs PORT=4100 RATE_LIMIT=100000 \
  setsid node dist/main.js > "$1/api.stdout" 2> "$1/api.stderr" < /dev/null &
echo $! > "$1/api.pid"
for _ in $(seq 1 120); do
  [ "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4100/health/ready 2>/dev/null)" = 200 ] && { echo "API ready (pid $(cat "$1/api.pid"))"; exit 0; }
  sleep 0.5
done
echo "API did not become ready"; exit 1
