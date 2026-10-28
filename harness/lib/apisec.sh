# Shared stack helpers for the apisec, apisec2 and oidc jobs. Source after common.sh.
SEC_LIB="$HARNESS/lib/apisec"
SEC_RUN="$WORK/run"; SEC_LOGS="$EV/_logs"; SEC_BIN="$WORK/bin"
KC_URL=http://localhost:8080
mkdir -p "$SEC_RUN" "$SEC_LOGS" "$SEC_BIN"
export KC_URL SEC_RUN SEC_LOGS WS WORK EV HARNESS
TOXI_IMAGE="ghcr.io/shopify/toxiproxy:2.12.0@sha256:9378ed52a28bc50edc1350f936f518f31fa95f0d15917d6eb40b8e376d1a214e"
REDIS_IMAGE="redis:8.2.2@sha256:4521b581dbddea6e7d81f8fe95ede93f5648aaa66a9dacd581611bf6fe7527bd"
CADDY_IMAGE="caddy:2.10.2@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb"
ZAP_IMAGE="zaproxy/zap-stable:2.16.1@sha256:7840969c7c9fead565bf9734b12f49f6886db90b1d35b1f74d79710bbd081dab"

sec_env() {
  export CLONE="$WS" PGPASSWORD="$PG_PASSWORD"
  export ALICE_PASSWORD="$KC_USER_PASSWORD" BOB_PASSWORD="$KC_USER_PASSWORD" MALLORY_PASSWORD="$KC_USER_PASSWORD"
  export ACME_CLI_SECRET="$KC_ACME_CLI_SECRET" ACME_NOAUD_SECRET="$KC_ACME_NOAUD_SECRET" ACME_WEB_SECRET="$KC_ACME_WEB_SECRET" OTHER_CLI_SECRET="$KC_OTHER_CLI_SECRET"
  export KC_ADMIN_PASSWORD PG_PASSWORD
  export EV_ENV_NAMES="CLONE OUT ALICE_PASSWORD BOB_PASSWORD ACME_CLI_SECRET PG_PASSWORD KC_ADMIN_PASSWORD"
}

sec_tools() {
  local need=""
  command -v psql >/dev/null || need="$need postgresql-client"
  command -v redis-cli >/dev/null || need="$need redis-tools"
  command -v lsof >/dev/null || need="$need lsof"
  command -v jq >/dev/null || need="$need jq"
  [ -z "$need" ] || ev_run "_setup-$JOB" apt-tools -- bash -c "sudo apt-get update -qq && sudo apt-get install -y -qq $need"
}

# sec_prepare: tools, frozen install, production build, shared infra, realm check.
sec_prepare() {
  sec_tools || return 1
  ws_install || return 1
  ws_build || return 1
  infra_up postgres redis keycloak || return 1
  ev_run "_setup-$JOB" realms -- bash -c 'curl -sf http://localhost:8080/realms/acme/.well-known/openid-configuration >/dev/null && curl -sf http://localhost:8080/realms/other/.well-known/openid-configuration >/dev/null'
}

# sec_fail_all REASON AC...
sec_fail_all() { local r="$1"; shift; for a in "$@"; do verdict "$a" FAIL "$r"; done; }

db_new() { # NAME : disposable database, migrated by the app's own runner
  local db="$1"
  docker compose -f "$HARNESS/infra/compose.yaml" exec -T postgres createdb -U postgres "$db" || return 1
  ( cd "$WS/apps/api" && DATABASE_URL="postgresql://postgres:$PG_PASSWORD@127.0.0.1:5432/$db" node scripts/migrate.mjs )
}

wait_http() { # URL SECONDS [CURL_OPTS]
  local i; for i in $(seq 1 "$2"); do [ "$(curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" = 200 ] && return 0; sleep 1; done; return 1
}

svc_start() { # NAME CWD VAR=VAL... cmd...   (clean environment; only names go to the log header)
  local name="$1" dir="$2"; shift 2
  local log="$SEC_LOGS/$name.log" names="" a
  for a in "$@"; do case "$a" in [A-Za-z_]*=*) names="$names ${a%%=*}";; *) break;; esac; done
  echo "=== start $(date -u +%FT%TZ) env names: $names" >> "$log"
  ( cd "$dir" && exec env -i PATH="$PATH" HOME="$HOME" "$@" ) >> "$log" 2>&1 &
  echo $! > "$SEC_RUN/$name.pid"
}
svc_stop() {
  local f="$SEC_RUN/$1.pid" p; [ -f "$f" ] || return 0; p=$(cat "$f")
  kill "$p" 2>/dev/null; for _ in $(seq 1 20); do kill -0 "$p" 2>/dev/null || break; sleep 0.5; done
  kill -9 "$p" 2>/dev/null; rm -f "$f"; return 0
}
api_start() { # NAME PORT DB [VAR=VAL...]
  local name="$1" port="$2" db="$3"; shift 3
  svc_stop "$name"
  svc_start "$name" "$WS/apps/api" NODE_ENV=test PORT="$port" DATABASE_URL="postgresql://postgres:$PG_PASSWORD@127.0.0.1:5432/$db" \
    AUTH_ISSUER="$KC_URL/realms/acme" AUTH_AUDIENCE=acme-api AUTH_JWKS_URL="$KC_URL/realms/acme/protocol/openid-connect/certs" "$@" node dist/main.js
  wait_http "http://127.0.0.1:$port/health/live" 60 || { echo "api $name not live"; tail -20 "$SEC_LOGS/$name.log"; return 1; }
}
web_start() { # NAME PORT API_PORT NAMESPACE [VAR=VAL...]
  local name="$1" port="$2" apip="$3" ns="$4"; shift 4
  svc_stop "$name"
  svc_start "$name" "$WS/apps/web" NODE_ENV=production PORT="$port" HOSTNAME=127.0.0.1 API_BASE_URL="http://127.0.0.1:$apip" AUTH_MODE=oidc \
    AUTH_APP_ORIGIN="http://localhost:$port" AUTH_ISSUER="$KC_URL/realms/acme" AUTH_CLIENT_ID=acme-web AUTH_CLIENT_SECRET="$KC_ACME_WEB_SECRET" \
    AUTH_REDIS_URL=redis://127.0.0.1:6379 AUTH_NAMESPACE="$ns" AUTH_TRANSACTION_SECRET="$AUTH_TRANSACTION_SECRET" $( [ -z "${WEB_HTTPS:-}" ] && echo AUTH_INSECURE_LOOPBACK=true ) "$@" node scripts/start.mjs
  wait_http "http://127.0.0.1:$port/healthz" 90 || { echo "web $name not up"; tail -20 "$SEC_LOGS/$name.log"; return 1; }
}
export -f svc_start svc_stop api_start web_start wait_http

toxi_up() {
  docker run -d --name sec-toxi --network host --cpus=2 --memory=2g "$TOXI_IMAGE" -host 127.0.0.1 -port 8474 >/dev/null || return 1
  wait_http http://127.0.0.1:8474/version 30 || return 1
  curl -sf -X POST http://127.0.0.1:8474/proxies -d '{"name":"pg","listen":"127.0.0.1:15432","upstream":"127.0.0.1:5432","enabled":true}' >/dev/null
}
redis_up() { # NAME PORT
  docker run -d --name "$1" --cpus=2 --memory=2g -p "127.0.0.1:$2:6379" "$REDIS_IMAGE" redis-server --save "" --appendonly no >/dev/null || return 1
  for _ in $(seq 1 30); do redis-cli -p "$2" ping 2>/dev/null | grep -q PONG && return 0; sleep 1; done; return 1
}

kc_admin_token() { curl -s -X POST "$KC_URL/realms/master/protocol/openid-connect/token" -d grant_type=password -d client_id=admin-cli -d username=admin --data-urlencode "password=$KC_ADMIN_PASSWORD" | jq -r .access_token; }
kc_realm_put() { curl -s -o /dev/null -w '%{http_code}' -X PUT -H "authorization: Bearer $(kc_admin_token)" -H 'content-type: application/json' "$KC_URL/admin/realms/$1" -d "$2"; }

# ac_check AC "label" 1|0 "detail": append a bash-side check to the criterion's assert.json
ac_check() {
  local ac="$1" label="$2" ok="$3" detail="${4:-}" f="$EV/$1/assert.json"
  mkdir -p "$EV/$ac"; [ -s "$f" ] || echo "{\"ac\":\"$ac\",\"checks\":[],\"notes\":{}}" > "$f"
  jq --arg l "$label" --argjson ok "$([ "$ok" = 1 ] && echo true || echo false)" --arg d "$detail" '.checks += [{label:$l, ok:$ok, detail:$d}]' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
}
# run_phase AC label [cwd] -- cmd... : ev_run plus a "completed with exit 0" check
run_phase() {
  local ac="$1" label="$2"; shift 2
  ev_run "$ac" "$label" "$@"; local c=$?
  ac_check "$ac" "phase $label exit 0" "$([ $c = 0 ] && echo 1 || echo 0)" "exit $c"
  return $c
}
# log5xx FILE... : count request.complete / request.deadline lines with status >= 500
log5xx() { cat "$@" 2>/dev/null | jq -R 'fromjson? | select((.event=="request.complete" or .event=="request.deadline") and (.status>=500))' 2>/dev/null | jq -s 'length'; }

verdict_from() { # AC [extra]
  local ac="$1" f="$EV/$1/assert.json" total failed
  [ -s "$f" ] || { verdict "$ac" FAIL "no assertions recorded (script did not run to completion)"; return; }
  total=$(jq '.checks|length' "$f"); failed=$(jq '[.checks[]|select(.ok|not)]|length' "$f")
  if [ "$total" -gt 0 ] && [ "$failed" = 0 ]; then verdict "$ac" PASS "$total/$total checks passed${2:+; $2}"
  else verdict "$ac" FAIL "$failed/$total checks failed: $(jq -r '[.checks[]|select(.ok|not)|.label]|join("; ")' "$f" | cut -c1-600)${2:+; $2}"; fi
}

redact_evidence() {
  python3 - "$EV" "$RES" "$WORK/.secrets" <<'PY'
import os,sys,zipfile,io,re
vals=[l.split('=',1)[1].strip().encode() for l in open(sys.argv[3]) if '=' in l]
jwt=re.compile(rb'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}')
def clean(b):
    for v in vals:
        if v and v in b: b=b.replace(v,b'REDACTED')
    return jwt.sub(b'REDACTED-JWT',b)
for base in sys.argv[1:3]:
  for root,_,fs in os.walk(base):
    for f in fs:
        p=os.path.join(root,f)
        try:
            if f.endswith('.zip'):
                out=io.BytesIO()
                with zipfile.ZipFile(p) as zi, zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as zo:
                    for i in zi.infolist(): zo.writestr(i.filename, clean(zi.read(i.filename)))
                open(p,'wb').write(out.getvalue())
            elif os.path.getsize(p)<200_000_000:
                b=open(p,'rb').read(); c=clean(b)
                if c!=b: open(p,'wb').write(c)
        except Exception as e: print('redact skip',p,e)
PY
}
sec_cleanup() {
  for f in "$SEC_RUN"/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null; done
  docker ps -aq --filter name=sec- | xargs -r docker rm -f >/dev/null 2>&1
  redact_evidence
}
