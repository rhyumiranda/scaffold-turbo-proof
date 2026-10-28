#!/bin/bash
# Shared runtime helpers for the data, resilience and observability jobs ("dro").
# Source after setting JOB. Builds on common.sh (ev_run, verdict, secrets_init, ws_install, ws_build, ...).
. "$(dirname "${BASH_SOURCE[0]}")/common.sh"
DRO_DIR="$HARNESS/lib/dro"
RT="$WORK/rt"                         # pid files and scratch (not evidence)
mkdir -p "$RT/pids"
TOXI_URL=http://127.0.0.1:8474
PGC="${PGC:-}"                        # name of the PostgreSQL container used for read-only SQL and database creation
export WS EV RES HARNESS DRO_DIR PGC TOXI_URL

dro_epoch() { date +%s.%N; }
dro_now() { date -u +%FT%TZ; }
dro_secs() { python3 -c "print(round($2-$1,2))"; }

# ev_note AC text...   Append a line to the criterion's commands.md.
ev_note() { local ac="$1"; shift; mkdir -p "$EV/$ac"; printf '%s\n' "$*" >> "$EV/$ac/commands.md"; }

# dro_guard AC-NN...   Any owned criterion without a verdict when the script ends gets FAIL (never a silent gap).
DRO_OWNED=""
dro_guard() { DRO_OWNED="$*"; trap dro_finish EXIT; }
dro_finish() {
  local ac
  for ac in $DRO_OWNED; do
    [ -s "$RES/$ac.json" ] || verdict "$ac" FAIL "the job ended before this criterion produced a verdict (see evidence/_setup-$JOB)"
  done
  dro_cleanup
}
# dro_fail_all reason AC-NN...
dro_fail_all() { local why="$1" ac; shift; for ac in "$@"; do [ -s "$RES/$ac.json" ] || verdict "$ac" FAIL "$why"; done; }

# Stop every process this script started (pid files) and the group's compose services.
dro_cleanup() {
  local f
  for f in "$RT"/pids/*.pid; do
    [ -e "$f" ] || continue
    kill -TERM "$(cat "$f")" 2>/dev/null
  done
  sleep 1
  for f in "$RT"/pids/*.pid; do [ -e "$f" ] && kill -KILL "$(cat "$f")" 2>/dev/null; done
  [ -n "${DRO_COMPOSE:-}" ] && docker compose -f "$DRO_COMPOSE" down -v --remove-orphans >/dev/null 2>&1
  return 0
}

# ---------- background processes ----------
# dro_launch AC label cwd NAME=VALUE... -- command...
# Starts a process with a minimal environment (only the NAME=VALUE pairs given), output to $EV/AC/label.stdout|stderr.
# Sets DRO_PID. Values of secret-looking names are not written to commands.md.
dro_launch() {
  local ac="$1" label="$2" dir="$3"; shift 3
  local envs=() shown=() a name
  while [ $# -gt 0 ] && [ "$1" != "--" ]; do
    envs+=("$1"); a="$1"; name="${a%%=*}"
    if [[ "$name" =~ (PASSWORD|SECRET|TOKEN|COOKIE|DATABASE_URL|REDIS_URL|ENCRYPTION_KEY) ]]; then shown+=("$name=<hidden>"); else shown+=("$a"); fi
    shift
  done
  shift
  local d="$EV/$ac"; mkdir -p "$d"
  ( cd "$dir" && exec env -i PATH="$PATH" HOME="${HOME:-/home/runner}" LANG=C.UTF-8 TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1 "${envs[@]}" "$@" ) > "$d/$label.stdout" 2> "$d/$label.stderr" &
  DRO_PID=$!
  echo "$DRO_PID" > "$RT/pids/$label.pid"
  {
    echo "### $label (background process)"; echo '```'; printf '%s ' "${shown[@]}" "$@"; echo; echo '```'
    echo "- cwd: ${dir#$WORK/}"; echo "- pid: $DRO_PID  start: $(dro_now)"; echo "- stdout: $label.stdout  stderr: $label.stderr"; echo
  } >> "$d/commands.md"
}

# dro_stop label [timeout_s]   SIGTERM, wait, then SIGKILL. Sets DRO_EXIT (exit code) and DRO_STOP_SECS.
dro_stop() {
  local label="$1" t="${2:-15}" pid i s
  pid="$(cat "$RT/pids/$label.pid" 2>/dev/null)"
  [ -n "$pid" ] || { DRO_EXIT=""; return 0; }
  s="$(dro_epoch)"
  kill -TERM "$pid" 2>/dev/null
  for ((i = 0; i < t * 10; i++)); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null; DRO_EXIT=$?
  DRO_STOP_SECS="$(dro_secs "$s" "$(dro_epoch)")"
  rm -f "$RT/pids/$label.pid"
}

# dro_wait_http url [timeout_s] [ok_regex]
dro_wait_http() {
  local url="$1" t="${2:-60}" ok="${3:-^200$}" i code
  for ((i = 0; i < t * 2; i++)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$url" 2>/dev/null)"
    [[ "$code" =~ $ok ]] && return 0
    sleep 0.5
  done
  return 1
}

# ---------- toxiproxy ----------
toxi_start() { docker compose -f "$1" up -d >/dev/null 2>&1 && dro_wait_http "$TOXI_URL/version" 60; }
toxi_proxy() { curl -fsS -X POST "$TOXI_URL/proxies" -d "{\"name\":\"$1\",\"listen\":\"$2\",\"upstream\":\"$3\"}" >/dev/null; }
# toxi_toxic proxy name type stream attributes-json
toxi_toxic() { curl -fsS -X POST "$TOXI_URL/proxies/$1/toxics" -d "{\"name\":\"$2\",\"type\":\"$3\",\"stream\":\"$4\",\"attributes\":$5}" >/dev/null; }
toxi_untoxic() { curl -fsS -X DELETE "$TOXI_URL/proxies/$1/toxics/$2" >/dev/null; }
toxi_enable() { curl -fsS -X POST "$TOXI_URL/proxies/$1" -d "{\"enabled\":$2}" >/dev/null; }
toxi_reset() { curl -fsS -X POST "$TOXI_URL/reset" >/dev/null; }
# toxi_ev AC label proxy name type stream attributes-json   Same as toxi_toxic, recorded in the evidence.
toxi_ev() {
  ev_run "$1" "$2" -- curl -sS -X POST "$TOXI_URL/proxies/$3/toxics" -d "{\"name\":\"$4\",\"type\":\"$5\",\"stream\":\"$6\",\"attributes\":$7}"
}
toxi_untoxic_ev() { ev_run "$1" "$2" -- curl -sS -X DELETE "$TOXI_URL/proxies/$3/toxics/$4"; }

# ---------- PostgreSQL (database creation is provisioning; SQL is read-only) ----------
dro_createdb() {
  case "$1" in *_test) ;; *) echo "database name must end in _test" >&2; return 2 ;; esac
  docker exec "$PGC" createdb -U postgres "$1"
}
dro_url() { printf 'postgresql://postgres:%s@%s/%s' "$PG_PASSWORD" "${2:-127.0.0.1:5432}" "$1"; }
# Read-only SQL through psql inside the PostgreSQL container (local socket, no password in evidence).
dro_psql() {
  local db="$1" sql="$2"
  case "$db" in *_test | postgres) ;; *) echo "refusing database $db (name must end in _test)" >&2; return 2 ;; esac
  if printf '%s' "$sql" | grep -Eiq '(^|[^a-z_])(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|reindex|do|call)([^a-z_]|$)'; then
    echo "refusing SQL that is not read-only" >&2; return 2
  fi
  docker exec -i "$PGC" psql -U postgres -d "$db" -v ON_ERROR_STOP=1 -At -F '|' -c "$sql"
}
export -f dro_psql
# dro_psql_ev AC label db sql   Read-only query, recorded with ev_run.
dro_psql_ev() { ev_run "$1" "$2" -- bash -c 'dro_psql "$1" "$2"' _ "$3" "$4"; }
# dro_snapshot AC label db [xmin]   Schema, constraints, indexes and ledger (plus row xmin with the 4th argument).
dro_snapshot() { ev_run "$1" "$2" -- bash "$DRO_DIR/snapshot.sh" "$3" "${4:-}"; }

# ---------- Keycloak ----------
# kc_token user   (stdout: access token)  acme-cli direct grant against $KC_ISSUER
kc_token() {
  curl -sS --max-time 20 -X POST "$KC_ISSUER/protocol/openid-connect/token" -d grant_type=password -d client_id=acme-cli \
    --data-urlencode "client_secret=$KC_ACME_CLI_SECRET" -d "username=$1" --data-urlencode "password=$KC_USER_PASSWORD" -d scope=openid | jq -r '.access_token // empty'
}
# kc_token_var NAME user   Fetches a token into the exported variable NAME and masks it in the log.
kc_token_var() {
  local v; v="$(kc_token "$2")"
  [ -n "$v" ] || { echo "token fetch failed for $2" >&2; return 1; }
  echo "::add-mask::$v"; printf -v "$1" '%s' "$v"; export "$1"
}
kc_wait() { local i; for ((i = 0; i < 60; i++)); do [ -n "$(kc_token alice 2>/dev/null)" ] && return 0; sleep 2; done; return 1; }
dro_jwt_sub() { python3 -c 'import sys,json,base64;t=sys.argv[1].split(".")[1];t+="="*(-len(t)%4);print(json.loads(base64.urlsafe_b64decode(t))["sub"])' "$1"; }

# ---------- the apps (production builds) ----------
# api_start label dbhostport db [NAME=VALUE...]   (uses API_PORT WEB_PORT KC_ISSUER; later NAME=VALUE override defaults)
api_start() {
  local label="$1" dbhp="$2" db="$3"; shift 3
  dro_launch "_runtime-$JOB" "$label" "$WS/apps/api" \
    NODE_ENV=test "DATABASE_URL=$(dro_url "$db" "$dbhp")" "AUTH_ISSUER=$KC_ISSUER" AUTH_AUDIENCE=acme-api \
    "AUTH_JWKS_URL=$KC_ISSUER/protocol/openid-connect/certs" "PORT=$API_PORT" "WEB_ORIGIN=http://localhost:$WEB_PORT" \
    RATE_LIMIT=100000 TELEMETRY_EXPORTER=none "$@" -- node dist/main.js
  API_PID=$DRO_PID
  dro_wait_http "http://127.0.0.1:$API_PORT/health/live" 40
}
# web_start label api_base_url [NAME=VALUE...]
web_start() {
  local label="$1" base="$2"; shift 2
  dro_launch "_runtime-$JOB" "$label" "$WS/apps/web" \
    "PORT=$WEB_PORT" HOSTNAME=127.0.0.1 "API_BASE_URL=$base" AUTH_MODE=oidc "AUTH_APP_ORIGIN=http://localhost:$WEB_PORT" \
    "AUTH_ISSUER=$KC_ISSUER" AUTH_CLIENT_ID=acme-web "AUTH_CLIENT_SECRET=$KC_ACME_WEB_SECRET" \
    AUTH_REDIS_URL=redis://127.0.0.1:6379 "AUTH_NAMESPACE=${WEB_NS:-web}" AUTH_INSECURE_LOOPBACK=true "$@" -- node scripts/start.mjs
  WEB_PID=$DRO_PID
  dro_wait_http "http://127.0.0.1:$WEB_PORT/healthz" 60
}

# dro_prepare   Install, build and install the browser; records into evidence/_setup-JOB.
dro_prepare() { ws_install && ws_build && playwright_install; }

# Environment for the Node (Playwright) scenario scripts.
dro_node_env() {
  export WEB_URL="http://localhost:$WEB_PORT" API_URL="http://127.0.0.1:$API_PORT"
  export EV_ENV_NAMES="${1:-WS WEB_URL API_URL KC_ISSUER KC_ACME_CLI_SECRET KC_USER_PASSWORD TOXI_URL}"
}
