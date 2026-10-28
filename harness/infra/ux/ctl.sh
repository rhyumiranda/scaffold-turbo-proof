#!/bin/bash
# Start, stop or restart the production API and web processes used by the UX checks.
#   ctl.sh api|web|webshort start|stop|restart
# Reads $WORK (the "acc run" folder) from the environment; secrets come from $WORK/.secrets (mode 600).
set -u
: "${WORK:?WORK is required}"
WS="$WORK/ws"; UXR="$WORK/ux"; mkdir -p "$UXR"
set -a; . "$WORK/.secrets"; set +a
UX_DB="${UX_DB:-ux_ui_test}"
API_PORT=4101; PROXY_PORT=50410

stop_proc() {
  local pidf="$UXR/$1.pid" pid
  [ -f "$pidf" ] || return 0
  pid="$(cat "$pidf")"
  kill -TERM "$pid" 2>/dev/null
  for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
  kill -KILL "$pid" 2>/dev/null || true
  rm -f "$pidf"
}
wait_ok() { # url
  for _ in $(seq 1 200); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$1" 2>/dev/null)" = 200 ] && return 0
    sleep 0.3
  done
  echo "timeout waiting for $1" >&2; return 1
}
start_api() {
  stop_proc api
  ( cd "$WS/apps/api" || exit 1
    export NODE_ENV=test DATABASE_URL="postgresql://postgres:$PG_PASSWORD@127.0.0.1:5432/$UX_DB"
    export AUTH_ISSUER=http://localhost:8080/realms/acme AUTH_AUDIENCE=acme-api
    export AUTH_JWKS_URL=http://localhost:8080/realms/acme/protocol/openid-connect/certs
    export PORT=$API_PORT RATE_LIMIT=100000 TELEMETRY_EXPORTER=none
    nohup node dist/main.js >> "$UXR/api.log" 2>&1 < /dev/null &
    echo $! > "$UXR/api.pid" )
  wait_ok "http://127.0.0.1:$API_PORT/health/ready"
}
start_web() { # name port namespace [session-seconds]
  stop_proc "$1"
  ( cd "$WS/apps/web" || exit 1
    export NODE_ENV=production API_BASE_URL="http://127.0.0.1:$PROXY_PORT" PORT="$2" HOSTNAME=127.0.0.1
    export AUTH_MODE=oidc AUTH_APP_ORIGIN="http://localhost:$2" AUTH_ISSUER=http://localhost:8080/realms/acme
    export AUTH_CLIENT_ID=acme-web AUTH_CLIENT_SECRET="$KC_ACME_WEB_SECRET"
    export AUTH_REDIS_URL=redis://127.0.0.1:6379 AUTH_NAMESPACE="$3" AUTH_INSECURE_LOOPBACK=true
    if [ -n "${4:-}" ]; then export AUTH_SESSION_SECONDS="$4"; fi
    nohup node scripts/start.mjs >> "$UXR/$1.log" 2>&1 < /dev/null &
    echo $! > "$UXR/$1.pid" )
  wait_ok "http://127.0.0.1:$2/healthz"
}
action() {
  case "$1:$2" in
    api:start|api:restart) start_api ;;
    api:stop) stop_proc api ;;
    web:start|web:restart) start_web web 3101 uxmain ;;
    web:stop) stop_proc web ;;
    webshort:start|webshort:restart) start_web webshort 3102 uxshort 60 ;;
    webshort:stop) stop_proc webshort ;;
    *) echo "usage: ctl.sh api|web|webshort start|stop|restart" >&2; return 2 ;;
  esac
}
before="$(cat "$UXR/$1.pid" 2>/dev/null || echo none)"
action "$1" "${2:-}"; code=$?
echo "$1 ${2:-}: pid $before -> $(cat "$UXR/$1.pid" 2>/dev/null || echo none) (exit $code)"
exit $code
