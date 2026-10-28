#!/bin/bash
# Observability: AC-26, AC-59, AC-60, AC-61, AC-62.
. "$(dirname "$0")/../lib/dro.sh"
provenance || exit 1
secrets_init
dro_guard AC-26 AC-59 AC-60 AC-61 AC-62
OWNED="AC-26 AC-59 AC-60 AC-61 AC-62"

export API_PORT=4103 WEB_PORT=3103 WEB_NS=obs
export KC_ISSUER="http://localhost:8080/realms/acme"
export DRO_COMPOSE="$HARNESS/infra/observability/compose.yaml"
SETUP="_setup-$JOB"
DB=obs_test
OTEL_OUT="$WORK/otel-out"; mkdir -p "$OTEL_OUT"; chmod 777 "$OTEL_OUT"
export OTEL_OUT DRO_UID="$(id -u)" DRO_GID="$(id -g)"
RTDIR="$EV/_runtime-$JOB"
NEEDLES_FILE="$WORK/.needles.json"; COOKIE_FILE="$WORK/.cookie"

ev_run "$SETUP" infra-start -- bash -c 'cd "$HARNESS/infra" && docker compose up -d postgres redis keycloak'
ev_run "$SETUP" collector-start -- docker compose -f "$DRO_COMPOSE" up -d
dro_prepare || { dro_fail_all "setup failed: install, build or browser install (evidence/$SETUP)" $OWNED; exit 0; }
infra_up postgres redis keycloak || { dro_fail_all "setup failed: PostgreSQL, Redis or Keycloak did not become healthy" $OWNED; exit 0; }
dro_wait_http http://127.0.0.1:4318/v1/traces 60 '^(200|404|405)$' || { dro_fail_all "setup failed: OpenTelemetry Collector not listening on 4318" $OWNED; exit 0; }
export PGC="$(docker compose -f "$HARNESS/infra/compose.yaml" ps -q postgres)"
kc_wait || { dro_fail_all "setup failed: Keycloak token endpoint did not answer" $OWNED; exit 0; }

ev_run "$SETUP" create-db -- docker exec "$PGC" createdb -U postgres $DB
export DATABASE_URL="$(dro_url $DB)" NODE_ENV=test EV_ENV_NAMES="DATABASE_URL NODE_ENV"
ev_run "$SETUP" migrate -- pnpm migrate || { dro_fail_all "setup failed: pnpm migrate" $OWNED; exit 0; }
unset EV_ENV_NAMES
OTLP=http://127.0.0.1:4318
api_start api-1 127.0.0.1:5432 $DB TELEMETRY_EXPORTER=otlp "OTEL_EXPORTER_OTLP_ENDPOINT=$OTLP" || { dro_fail_all "the API did not start (evidence/_runtime-$JOB)" $OWNED; exit 0; }
web_start web-1 "http://127.0.0.1:$API_PORT" "OTEL_EXPORTER_OTLP_ENDPOINT=$OTLP" || { dro_fail_all "the web app did not start (evidence/_runtime-$JOB)" $OWNED; exit 0; }

# ---------- the journey (sign-in, create, open, rename, sign out) ----------
export OUT="$EV/AC-59"; mkdir -p "$OUT"
export WS WEB_URL="http://localhost:$WEB_PORT" API_URL="http://127.0.0.1:$API_PORT" TOXI_URL KC_ISSUER KC_USER_PASSWORD NEEDLES_FILE COOKIE_FILE WEB_NS OUT
export EV_ENV_NAMES="WS WEB_URL API_URL KC_ISSUER KC_USER_PASSWORD NEEDLES_FILE COOKIE_FILE WEB_NS OUT"
ev_run AC-59 journey -- node "$DRO_DIR/obs_journey.mjs"; JRC=$?
unset EV_ENV_NAMES

# ---------- AC-26 hostile requests with sentinels ----------
RND="$(openssl rand -hex 6)"
export S_A="SENTINEL-AC26-a-$RND" S_B="SENTINEL-AC26-b-$RND" S_C="SENTINEL-AC26-c-$RND" S_D="SENTINEL-AC26-d-$RND"
kc_token_var TOKEN alice
export API_URL WEB_URL EV_ENV_NAMES="S_A S_B S_C S_D TOKEN API_URL WEB_URL"
ev_run AC-26 sentinel-requests -- bash "$DRO_DIR/sentreq.sh"
unset EV_ENV_NAMES

# ---------- AC-60 hostile correlation headers ----------
ev_run AC-60 hostile-headers -- python3 "$DRO_DIR/ac60.py" "$API_PORT" "$WEB_PORT"
sleep 1

# Let periodic exporters run, then stop both apps (flushes telemetry).
sleep 14
dro_stop web-1 20; dro_stop api-1 20
sleep 4
cp "$OTEL_OUT/otel.jsonl" "$EV/AC-61/otel.jsonl" 2>/dev/null || { mkdir -p "$EV/AC-61"; cp "$OTEL_OUT/otel.jsonl" "$EV/AC-61/otel.jsonl" 2>/dev/null; }
docker logs dro-otel > "$EV/AC-61/collector.log" 2>&1
APIO="$RTDIR/api-1.stdout"; APIE="$RTDIR/api-1.stderr"; WEBO="$RTDIR/web-1.stdout"; WEBE="$RTDIR/web-1.stderr"
OTELF="$EV/AC-61/otel.jsonl"; JJ="$EV/AC-59/journey.json"

# ---------- AC-59 ----------
ac59() {
  local ac=AC-59 f="$EV/AC-59"
  [ "$JRC" = 0 ] || { verdict $ac FAIL "browser journey failed (exit $JRC)"; return; }
  ev_run $ac jq-per-line -- bash "$DRO_DIR/jqlines.sh" "$APIO" "$APIE" "$WEBO" "$WEBE"
  ev_run $ac logcheck -- python3 "$DRO_DIR/logcheck.py" "$JJ" "$f/logcheck.json" "$APIO" "$APIE" "$WEBO" "$WEBE"
  if [ "$(cat "$f/logcheck.exit")" = 0 ]; then verdict $ac PASS "$(jq -r '"\(.lines) lines, all JSON with time/level/event/service; \(.window_api_completions) API completions = \(.window_web_api_requests) web api.request in the journey; create traced by request id \(.create_request_id)"' "$f/logcheck.json")"; else verdict $ac FAIL "$(jq -r '.why|join("; ")' "$f/logcheck.json")"; fi
}
ac60() {
  local ac=AC-60 f="$EV/AC-60"
  grep '^{' "$f/hostile-headers.stdout" > "$f/requests.jsonl"
  ev_run $ac check -- python3 "$DRO_DIR/ac60_check.py" "$f/requests.jsonl" "$f/check.json" "$APIO" "$APIE" "$WEBO" "$WEBE"
  if [ "$(cat "$f/check.exit")" = 0 ] && [ "$(jq .requests "$f/check.json")" -ge 30 ]; then verdict $ac PASS "$(jq -r '"\(.requests) hostile requests (CRLF, quotes, 10 KB, bad traceparent) on both apps: 0 forged lines, returned ids replaced and <=128 chars, \(.log_lines) log lines all parse"' "$f/check.json")"; else verdict $ac FAIL "$(jq -r '.why|join("; ")' "$f/check.json" 2>/dev/null) requests=$(jq .requests "$f/check.json" 2>/dev/null)"; fi
}
ac26() {
  local ac=AC-26 f="$EV/AC-26"
  export NEEDLE_ENV="S_A S_B S_C S_D TOKEN KC_ACME_WEB_SECRET KC_ACME_CLI_SECRET KC_USER_PASSWORD PG_PASSWORD" EV_ENV_NAMES="NEEDLE_ENV"
  ev_run $ac leak-grep -- python3 "$DRO_DIR/leakgrep.py" "$NEEDLES_FILE" "$f/leak-grep.json" "$APIO" "$APIE" "$WEBO" "$WEBE" "$OTELF" "$EV/AC-61/collector.log"
  unset EV_ENV_NAMES
  local n; n="$(jq '.needles_checked|length' "$f/leak-grep.json" 2>/dev/null)"
  if [ "$(cat "$f/leak-grep.exit")" = 0 ] && [ "${n:-0}" -ge 12 ] && [ "$JRC" = 0 ]; then verdict $ac PASS "$n credentials searched (4 sentinels, real access/refresh/id tokens and signatures from Redis, session cookie, OIDC code, direct-grant token, client secrets, passwords) in API+web stdout/stderr and the Collector output: 0 hits"; else verdict $ac FAIL "hits=$(jq -c '[.files[]|select(.hits|length>0)|{file,hits}]' "$f/leak-grep.json" 2>/dev/null) needles=$n journeyExit=$JRC"; fi
}
ac61() {
  local ac=AC-61 f="$EV/AC-61" ok=1 why=""
  ev_run $ac otelcheck -- python3 "$DRO_DIR/otelcheck.py" "$OTELF" "$WEBO" "$JJ" "$f/otelcheck.json"
  [ "$(cat "$f/otelcheck.exit")" = 0 ] || { ok=0; why="$why $(jq -r '.why|join("; ")' "$f/otelcheck.json" 2>/dev/null)"; }
  test_env $DB
  ev_run $ac test-telemetry -- pnpm --filter @repo/api test:telemetry; local rt=$?
  unset EV_ENV_NAMES
  [ "$rt" = 0 ] || { ok=0; why="$why test:telemetry exit $rt;"; }
  if [ $ok = 1 ]; then verdict $ac PASS "trace $(jq -r .trace_id "$f/otelcheck.json") spans $(jq -c .services "$f/otelcheck.json"): postgres.query <- API http.request <- web span; http.server.duration histogram and db.pool.* metrics exported; no project name/credential in telemetry; test:telemetry exit 0"; else verdict $ac FAIL "${why# }"; fi
}
ac62() {
  local ac=AC-62 f="$EV/AC-62"
  ev_run $ac sli-check -- python3 "$DRO_DIR/ac62_check.py" "$WS/docs/operations.md" "$OTELF" "$f/sli.json" "$APIO" "$APIE" "$WEBO" "$WEBE"
  if [ "$(cat "$f/sli-check.exit")" = 0 ]; then verdict $ac PASS "docs/operations.md defines availability, latency and error-rate indicators with placeholder targets; every named signal appears in the collected metrics or logs: $(jq -c '[.indicators[].signals]|add|unique' "$f/sli.json")"; else verdict $ac FAIL "$(jq -r '.why|join("; ")' "$f/sli.json" 2>/dev/null)"; fi
}
ac59; ac26; ac60; ac61; ac62
