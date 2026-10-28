#!/bin/bash
# Reliability: AC-53, AC-54, AC-55, AC-56, AC-57.
. "$(dirname "$0")/../lib/dro.sh"
provenance || exit 1
secrets_init
dro_guard AC-53 AC-54 AC-55 AC-56 AC-57
OWNED="AC-53 AC-54 AC-55 AC-56 AC-57"

export API_PORT=4100 WEB_PORT=3000 WEB_NS=res
export KC_ISSUER="http://localhost:18080/realms/acme"
export DRO_COMPOSE="$HARNESS/infra/resilience/compose.yaml"
export PGC=dro-pg
SETUP="_setup-$JOB"
DB=res_test
API_DIRECT="http://127.0.0.1:$API_PORT"

ev_run "$SETUP" infra-start -- bash -c 'cd "$HARNESS/infra" && docker compose up -d keycloak'
ev_run "$SETUP" resilience-infra -- docker compose -f "$DRO_COMPOSE" up -d --wait
dro_prepare || { dro_fail_all "setup failed: install, build or browser install (evidence/$SETUP)" $OWNED; exit 0; }
# Container images for AC-57 build in the background while the other checks run.
export NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(openssl rand -base64 32)"; echo "::add-mask::$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"
(
  EV_ENV_NAMES="" ev_run AC-57 build-api-image -- docker build -f apps/api/Dockerfile --target runtime -t dro-api:ac57 .
  echo $? > "$RT/build-api.rc"
  EV_ENV_NAMES="NEXT_SERVER_ACTIONS_ENCRYPTION_KEY" ev_run AC-57 build-web-image -- docker build -f apps/web/Dockerfile --secret id=next_action_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY --build-arg APP_DEPLOYMENT_ID=local-1 -t dro-web:ac57 .
  echo $? > "$RT/build-web.rc"
) > /dev/null 2>&1 &
BUILDS=$!
infra_up keycloak || { dro_fail_all "setup failed: Keycloak did not become healthy" $OWNED; exit 0; }
dro_wait_http "$TOXI_URL/version" 60 || { dro_fail_all "setup failed: Toxiproxy" $OWNED; exit 0; }
toxi_proxy pg 127.0.0.1:15432 127.0.0.1:5432 && toxi_proxy api 127.0.0.1:14100 "127.0.0.1:$API_PORT" && toxi_proxy kc 127.0.0.1:18080 127.0.0.1:8080 || { dro_fail_all "setup failed: Toxiproxy proxies" $OWNED; exit 0; }
kc_wait || { dro_fail_all "setup failed: Keycloak token endpoint (through Toxiproxy) did not answer" $OWNED; exit 0; }

export DATABASE_URL="$(dro_url $DB)" NODE_ENV=test EV_ENV_NAMES="DATABASE_URL NODE_ENV"
ev_run "$SETUP" migrate -- pnpm migrate || { dro_fail_all "setup failed: pnpm migrate" $OWNED; exit 0; }
unset EV_ENV_NAMES

node_scripts() { export OUT="$EV/$1"; mkdir -p "$OUT"; export WS WEB_URL="http://localhost:$WEB_PORT" API_URL="$API_DIRECT" TOXI_URL KC_ISSUER KC_ACME_CLI_SECRET KC_USER_PASSWORD PID_DIR="$RT/pids" OUT; export EV_ENV_NAMES="WS WEB_URL API_URL TOXI_URL KC_ISSUER KC_ACME_CLI_SECRET KC_USER_PASSWORD PID_DIR OUT"; }

# ---------- AC-53 ----------
ac53() {
  local ac=AC-53 f="$EV/AC-53" ok=1 why="" n
  mkdir -p "$f"
  api_start api-53 127.0.0.1:5432 $DB RATE_LIMIT=100 || { verdict $ac FAIL "API did not start"; return; }
  local pid0=$API_PID
  export API_URL="$API_DIRECT" EV_ENV_NAMES="API_URL DRO_DIR"
  for n in 1 2; do
    ev_run $ac outage-run-$n -- bash "$DRO_DIR/ac53run.sh" "$f" $n
    ev_run $ac analysis-$n -- python3 "$DRO_DIR/ac53_analyze.py" "$f/timeline-$n.jsonl" "$f/events-$n.txt"
    [ "$(cat "$f/analysis-$n.exit")" = 0 ] || { ok=0; why="$why run $n: $(jq -r '.why|join("; ")' "$f/analysis-$n.stdout" 2>/dev/null);"; }
    sleep 3
  done
  # 500 rapid requests to each endpoint, then a control proving the limiter is active for this client.
  ev_run $ac rapid-live -- bash -c 'seq 500 | xargs -P 20 -I{} curl -s -o /dev/null -w "%{http_code}\n" "$API_URL/health/live" | sort | uniq -c'
  ev_run $ac rapid-ready -- bash -c 'seq 500 | xargs -P 20 -I{} curl -s -o /dev/null -w "%{http_code}\n" "$API_URL/health/ready" | sort | uniq -c'
  ev_run $ac control-limiter -- bash -c 'seq 150 | xargs -P 10 -I{} curl -s -o /dev/null -w "%{http_code}\n" "$API_URL/v1/projects" | sort | uniq -c'
  grep -q ' 429$' "$f/rapid-live.stdout" "$f/rapid-ready.stdout" && { ok=0; why="$why health endpoints returned 429;"; }
  [ "$(awk '{s+=$1} END{print s}' "$f/rapid-live.stdout")" = 500 ] && [ "$(awk '$2==200{print $1}' "$f/rapid-live.stdout")" = 500 ] || { ok=0; why="$why not all 500 live requests were 200;"; }
  [ "$(awk '$2==200{print $1}' "$f/rapid-ready.stdout")" = 500 ] || { ok=0; why="$why not all 500 ready requests were 200;"; }
  grep -q ' 429$' "$f/control-limiter.stdout" || { ok=0; why="$why control: the limiter never answered 429, so the no-429 result proves nothing;"; }
  curl -s -D "$f/live.headers" "$API_URL/health/live" > "$f/live.body"; curl -s "$API_URL/health/ready" > "$f/ready.body"
  kill -0 "$pid0" 2>/dev/null || { ok=0; why="$why API process died;"; }
  [ "$(grep -c startup.ready "$EV/_runtime-$JOB/api-53.stdout")" = 1 ] || { ok=0; why="$why API restarted (startup.ready != 1);"; }
  unset EV_ENV_NAMES
  dro_stop api-53 15
  if [ $ok = 1 ]; then verdict $ac PASS "live 200 throughout; ready 503 within $(jq -r .first503_after_stop_s "$f/analysis-1.stdout")s/$(jq -r .first503_after_stop_s "$f/analysis-2.stdout")s of DB stop and 200 $(jq -r .ready_200_after_recovery_s "$f/analysis-1.stdout")s/$(jq -r .ready_200_after_recovery_s "$f/analysis-2.stdout")s after PostgreSQL accepts, same pid; 500+500 rapid requests 0x429 while the control hit 429; bodies minimal"; else verdict $ac FAIL "${why# }"; fi
}

# ---------- shared stack (API through the PostgreSQL proxy, web through the API proxy) ----------
stack_up() {
  api_start api-1 127.0.0.1:15432 $DB || return 1
  web_start web-1 "http://127.0.0.1:14100" || return 1
}
ac54() {
  local ac=AC-54 f="$EV/AC-54" ok=1 why=""
  mkdir -p "$f"
  grep -n -i 'healthz\|smoke' "$WS/docs/operations.md" > "$f/docs-excerpt.txt"
  grep -q 'GET /healthz' "$f/docs-excerpt.txt" || { ok=0; why="$why /healthz is not documented;"; }
  local smoke; smoke="$(grep -E '^API=http://127.0.0.1:4100 WEB=http://127.0.0.1:3000 sh -c ' "$WS/docs/operations.md" | head -1)"
  [ -n "$smoke" ] || { ok=0; why="$why documented smoke command not found;"; }
  echo "$smoke" > "$f/smoke-command.txt"
  ev_run $ac smoke-up -- bash -c "$smoke"; [ "$(cat "$f/smoke-up.exit")" = 0 ] || { ok=0; why="$why smoke failed with the stack up;"; }
  dro_stop api-1 15
  local i; for i in 1 2 3 4 5; do curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$WEB_PORT/healthz" >> "$f/healthz-api-down.txt"; done
  [ "$(sort -u "$f/healthz-api-down.txt")" = 200 ] || { ok=0; why="$why web /healthz not 200 with the API stopped;"; }
  api_start api-1 127.0.0.1:15432 $DB || { ok=0; why="$why API did not restart;"; }
  ev_run $ac smoke-restored -- bash -c "$smoke"; [ "$(cat "$f/smoke-restored.exit")" = 0 ] || { ok=0; why="$why smoke failed after the API returned;"; }
  if [ $ok = 1 ]; then verdict $ac PASS "web GET /healthz documented; 5x200 with the API stopped; documented smoke command exit 0 with the stack up and again after the API returned"; else verdict $ac FAIL "${why# }"; fi
}

ac55() {
  local ac=AC-55 f="$EV/AC-55" ok=1 why=""
  mkdir -p "$f"; kc_token_var TOKEN alice || { verdict $ac FAIL "no token"; return; }
  export API_URL="$API_DIRECT"; export EV_ENV_NAMES="TOKEN API_URL"
  local P; P="$(curl -sS -X POST "$API_URL/v1/projects" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"AC55"}' | jq -r .id)"
  # (1) API -> database stall
  toxi_ev $ac db-toxic-add pg stall60 latency downstream '{"latency":60000,"jitter":0}'
  ev_run $ac db-stall -- bash "$DRO_DIR/ac55db.sh" "$f/db-stall-results.txt" "$P"
  toxi_untoxic_ev $ac db-toxic-remove pg stall60
  [ "$(grep -c . "$f/db-stall-results.txt")" = 4 ] || { ok=0; why="$why db stall recorded $(grep -c . "$f/db-stall-results.txt") of 4 requests;"; }
  awk '$2!=503 && $2!=504 || $3>7.0 {bad=1} END{exit bad}' "$f/db-stall-results.txt" || { ok=0; why="$why db stall: a request was not 503/504 within deadline+1s ($(tr '\n' ',' < "$f/db-stall-results.txt"));"; }
  # (2) web -> API stall (browser)
  node_scripts $ac
  ev_run $ac web-stall -- node "$DRO_DIR/ac55web.mjs"
  jq -e '.create.ms <= 5000 and .create.kept == true and .list.ms <= 6000' "$f/web-stall.json" > /dev/null 2>&1 || { ok=0; why="$why web stall: $(jq -c . "$f/web-stall.json" 2>/dev/null);"; }
  # (3) slow clients against both servers at once
  local at wt
  at="$(grep -oE 'requestTimeout = [0-9]+' "$WS/apps/api/src/app.ts" | grep -oE '[0-9]+')"; wt="$(grep -oE 'requestTimeout = [0-9]+' "$WS/apps/web/scripts/runtime-config.mjs" | grep -oE '[0-9]+')"
  echo "api requestTimeout=${at}ms web requestTimeout=${wt}ms" > "$f/timeouts-from-source.txt"
  ev_run $ac slowloris -- python3 "$DRO_DIR/slowloris.py" "$f/slowloris.json" \
    "127.0.0.1:$API_PORT:headers:30" "127.0.0.1:$API_PORT:body:30" "127.0.0.1:$API_PORT:headers:30" "127.0.0.1:$API_PORT:body:30" \
    "127.0.0.1:$WEB_PORT:headers:60" "127.0.0.1:$WEB_PORT:body:60" "127.0.0.1:$WEB_PORT:headers:60" "127.0.0.1:$WEB_PORT:body:60"
  python3 - "$f/slowloris.json" "$((at / 1000))" "$((wt / 1000))" <<'PY' > "$f/slowloris-verdict.txt" || { ok=0; why="$why slow clients: $(tr '\n' ' ' < "$f/slowloris-verdict.txt");"; }
import json, sys
rows = json.load(open(sys.argv[1])); api, web = int(sys.argv[2]), int(sys.argv[3])
bad = 0
for r in rows:
    limit = (api if r["target"].endswith(":4100") else web) + 1 + 0.3  # +1 s sweep interval per criterion, +0.3 s measurement jitter
    good = r["closed_after_s"] is not None and r["closed_after_s"] <= limit
    print(r["target"], r["mode"], r["closed_after_s"], "limit", limit, "ok" if good else "BAD"); bad += not good
sys.exit(1 if bad else 0)
PY
  # (4) identity provider JWKS stall: fresh API (no cached keys), unknown kid forces a fetch
  dro_stop api-1 15
  api_start api-jwks 127.0.0.1:15432 $DB || { ok=0; why="$why jwks API did not start;"; }
  export EV_ENV_NAMES="WS TOKEN API_URL FORGED"; export FORGED; FORGED="$(node "$DRO_DIR/forge.mjs" "$KC_ISSUER" acme-api unknown-kid-ac55)"
  toxi_ev $ac jwks-toxic-add kc stall60 latency downstream '{"latency":60000,"jitter":0}'
  ev_run $ac jwks-stall -- curl -s -m 30 -o /dev/null -w '%{http_code} %{time_total}\n' -H "authorization: Bearer $FORGED" "$API_URL/v1/projects"
  toxi_untoxic_ev $ac jwks-toxic-remove kc stall60
  awk '$1==401 && $2<=3 {ok=1} END{exit !ok}' "$f/jwks-stall.stdout" || { ok=0; why="$why JWKS stall: '$(cat "$f/jwks-stall.stdout")' (want 401 within 3 s);"; }
  unset EV_ENV_NAMES FORGED
  dro_stop api-jwks 15
  api_start api-1 127.0.0.1:15432 $DB || return
  if [ $ok = 1 ]; then verdict $ac PASS "DB stall: $(awk '{printf "%s %s %ss; ", $1,$2,$3}' "$f/db-stall-results.txt"); web->API stall error UI $(jq -r .create.ms "$f/web-stall.json") ms with input kept; JWKS stall $(cat "$f/jwks-stall.stdout"); slow clients closed within requestTimeout+1s"; else verdict $ac FAIL "${why# }"; fi
}

ac56() {
  local ac=AC-56 f="$EV/AC-56" ok=1 why=""
  node_scripts $ac
  ev_run $ac outages -- node "$DRO_DIR/ac56.mjs"; local rc=$?
  [ "$rc" = 0 ] || { ok=0; why="$why scenario script exit $rc;"; }
  local r="$f/results.json"
  jq -e '[.[]|select(.label=="pids")][0] | .unchanged and .alive' "$r" > /dev/null 2>&1 || { ok=0; why="$why process ids changed or a process died;"; }
  jq -e '[.[]|select(.label=="web-5xx")][0].withStack == 0' "$r" > /dev/null 2>&1 || { ok=0; why="$why a web 5xx carried stack text;"; }
  local d
  for d in postgres redis; do
    jq -e --arg d "$d" '[.[]|select(.label==($d+"-down"))][0] | .h1 != "Projects" and .retryControls >= 1 and (.stack|not)' "$r" > /dev/null 2>&1 || { ok=0; why="$why $d outage page lacks a message/retry or shows stack text;"; }
    jq -e --arg d "$d" '[.[]|select(.label==($d+"-down-api"))][0] | (.stack|not)' "$r" > /dev/null 2>&1 || { ok=0; why="$why $d outage: API answer carried stack text;"; }
    jq -e --arg d "$d" '[.[]|select(.label==($d+"-recovery"))][0] | .ok and .recoveredMs <= 15000' "$r" > /dev/null 2>&1 || { ok=0; why="$why $d: journey did not work within 15 s of return ($(jq -c --arg d "$d" '[.[]|select(.label==($d+"-recovery"))][0]' "$r"));"; }
  done
  jq -e '[.[]|select(.label=="keycloak-down-existing-token-api")][0].status == 200 and [.[]|select(.label=="keycloak-down-existing-token-api-25s")][0].status == 200' "$r" > /dev/null 2>&1 || { ok=0; why="$why existing token stopped working while Keycloak was down;"; }
  jq -e '[.[]|select(.label=="keycloak-down-fresh-login")][0] | .retryControls >= 1 and (.stack|not)' "$r" > /dev/null 2>&1 || { ok=0; why="$why fresh login during Keycloak outage: no retry action or stack text;"; }
  jq -e '[.[]|select(.label=="keycloak-recovery")][0] | .ok and .recoveredMs <= 15000' "$r" > /dev/null 2>&1 || { ok=0; why="$why sign-in journey did not work within 15 s of Keycloak returning;"; }
  if [ $ok = 1 ]; then verdict $ac PASS "PostgreSQL, Redis and Keycloak each down 30 s: outage pages with retry, no stack text, same pids; journeys recovered in $(jq -r '[.[]|select(.label|test("recovery"))|.recoveredMs]|map(tostring)|join("/")' "$r") ms; existing token worked while Keycloak was down"; else verdict $ac FAIL "${why# }"; fi
}

# AC-57 local-process case: ac57_case label latency_ms shutdown_ms mode(patch|upload)
ac57_case() {
  local ac=AC-57 label="$1" lat="$2" sd="$3" mode="$4" f="$EV/AC-57/$1"
  mkdir -p "$f"; kc_token_var TOKEN alice
  api_start s57-$label 127.0.0.1:15432 $DB SHUTDOWN_TIMEOUT_MS="$sd" || return 1
  local pid=$API_PID P; export API_URL="$API_DIRECT"
  P="$(curl -sS -X POST "$API_URL/v1/projects" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"AC57"}' | jq -r .id)"
  local i; for i in 1 2 3 4 5 6; do curl -s -o /dev/null -H "authorization: Bearer $TOKEN" "$API_URL/v1/projects/$P"; done
  [ "$lat" != 0 ] && toxi_toxic pg ac57 latency downstream "{\"latency\":$lat,\"jitter\":0}"
  local tp tpc
  if [ "$mode" = patch ]; then
    curl -s -m 60 -o "$f/patch.json" -w '%{http_code} %{time_total}\n' -X PATCH -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"AC57 renamed","expectedVersion":1}' "$API_URL/v1/projects/$P" > "$f/patch.status" & tpc=$!
  else
    export TOKEN; python3 "$DRO_DIR/hold_upload.py" "$API_PORT" 20 > "$f/upload.txt" & tpc=$!
  fi
  sleep 0.5
  local ts te; ts="$(dro_epoch)"; kill -TERM "$pid"
  sleep 1
  curl -s -m 5 -o /dev/null -w '%{http_code}\n' "$API_URL/health/live" > "$f/new-connection.txt" 2>&1; echo "curl exit $?" >> "$f/new-connection.txt"
  while kill -0 "$pid" 2>/dev/null; do sleep 0.05; done; te="$(dro_epoch)"
  wait "$pid"; local rc=$?
  echo "$rc" > "$f/api-exit-code.txt"; dro_secs "$ts" "$te" > "$f/exit-after-sigterm-s.txt"
  wait "$tpc" 2>/dev/null
  [ "$lat" != 0 ] && toxi_untoxic pg ac57
  rm -f "$RT/pids/s57-$label.pid"
  [ "$mode" = patch ] && dro_psql_ev $ac "row-$label" $DB "SELECT name, version FROM projects WHERE id='$P'" && cp "$EV/$ac/row-$label.stdout" "$f/row.txt"
  return 0
}
ac57() {
  local ac=AC-57 f="$EV/AC-57" ok=1 why=""
  mkdir -p "$f"
  dro_stop web-1 15; dro_stop api-1 15
  ac57_case drain-3s 3000 8000 patch
  ac57_case forced-20s 20000 5000 patch
  ac57_case forced-upload 0 5000 upload
  export EV_ENV_NAMES=""
  # case A
  [ "$(awk '{print $1}' "$f/drain-3s/patch.status")" = 200 ] || { ok=0; why="$why in-flight PATCH was not 200 ($(cat "$f/drain-3s/patch.status"));"; }
  [ "$(cat "$f/drain-3s/row.txt")" = "AC57 renamed|2" ] || { ok=0; why="$why PATCH not persisted ($(cat "$f/drain-3s/row.txt"));"; }
  grep -q 'curl exit [1-9]' "$f/drain-3s/new-connection.txt" || { ok=0; why="$why new connection was accepted after SIGTERM;"; }
  [ "$(cat "$f/drain-3s/api-exit-code.txt")" = 0 ] && awk '$1<=5{ok=1} END{exit !ok}' "$f/drain-3s/exit-after-sigterm-s.txt" || { ok=0; why="$why drain case exit $(cat "$f/drain-3s/api-exit-code.txt") after $(cat "$f/drain-3s/exit-after-sigterm-s.txt")s;"; }
  # case B (criterion's 20 s latency) and the forced path
  awk '$1<=6{ok=1} END{exit !ok}' "$f/forced-20s/exit-after-sigterm-s.txt" || { ok=0; why="$why 20 s latency case exit took $(cat "$f/forced-20s/exit-after-sigterm-s.txt")s;"; }
  [ "$(cat "$f/forced-upload/api-exit-code.txt")" = 1 ] && awk '$1<=6{ok=1} END{exit !ok}' "$f/forced-upload/exit-after-sigterm-s.txt" && grep -q 'shutdown.deadline' "$EV/_runtime-$JOB/s57-forced-upload.stdout" || { ok=0; why="$why forced exit: code $(cat "$f/forced-upload/api-exit-code.txt") after $(cat "$f/forced-upload/exit-after-sigterm-s.txt")s;"; }
  # containers
  wait "$BUILDS"
  [ "$(cat "$RT/build-api.rc" 2>/dev/null)" = 0 ] && [ "$(cat "$RT/build-web.rc" 2>/dev/null)" = 0 ] || { ok=0; why="$why image build failed;"; }
  local dbu; dbu="$(dro_url $DB)"; export DATABASE_URL="$dbu"
  export AUTH_ISSUER=https://identity.example.invalid AUTH_AUDIENCE=acme-api AUTH_JWKS_URL=https://identity.example.invalid/jwks
  export EV_ENV_NAMES="DATABASE_URL AUTH_ISSUER AUTH_AUDIENCE AUTH_JWKS_URL"
  ev_run $ac run-api-container -- docker run -d --name dro-api-c --network host --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --cpus=2 --memory=2g -e NODE_ENV=production -e PORT=4190 -e DATABASE_URL -e AUTH_ISSUER -e AUTH_AUDIENCE -e AUTH_JWKS_URL dro-api:ac57
  ev_run $ac run-web-container -- docker run -d --name dro-web-c --network host --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --cpus=2 --memory=2g -e NODE_ENV=production -e PORT=3190 -e HOSTNAME=127.0.0.1 -e API_BASE_URL=http://127.0.0.1:4190 dro-web:ac57
  dro_wait_http http://127.0.0.1:4190/health/live 40 || { ok=0; why="$why API container not live;"; }
  dro_wait_http http://127.0.0.1:3190/healthz 40 || { ok=0; why="$why web container not live;"; }
  local c s e
  for c in dro-api-c dro-web-c; do
    s="$(dro_epoch)"; ev_run $ac stop-$c -- docker stop -t 15 $c; e="$(dro_epoch)"
    docker inspect -f '{{.State.ExitCode}} oom={{.State.OOMKilled}}' $c > "$f/inspect-$c.txt"; docker logs $c > "$f/$c.log" 2>&1
    echo "stop took $(dro_secs "$s" "$e")s" >> "$f/inspect-$c.txt"
    awk '$1==0 && $NF!="" {ok=1} END{exit !ok}' "$f/inspect-$c.txt" && awk -v t="$(dro_secs "$s" "$e")" 'BEGIN{exit !(t<15)}' || { ok=0; why="$why $c: $(tr '\n' ' ' < "$f/inspect-$c.txt");"; }
  done
  # the repository's own runtime suites
  test_env $DB
  ev_run $ac test-runtime -- pnpm test:runtime; [ "$(cat "$f/test-runtime.exit")" = 0 ] || { ok=0; why="$why test:runtime exit $(cat "$f/test-runtime.exit");"; }
  unset EV_ENV_NAMES
  if [ $ok = 1 ]; then verdict $ac PASS "SIGTERM with 3 s DB latency: PATCH 200 + persisted, new connection refused, exit 0 in $(cat "$f/drain-3s/exit-after-sigterm-s.txt")s; 20 s latency case exit $(cat "$f/forced-20s/api-exit-code.txt") in $(cat "$f/forced-20s/exit-after-sigterm-s.txt")s; forced path exit 1 in $(cat "$f/forced-upload/exit-after-sigterm-s.txt")s; both containers exit 0 on docker stop -t 15; test:runtime exit 0"; else verdict $ac FAIL "${why# }"; fi
}

ac53
if stack_up; then
  ac54; ac55; ac56
else
  dro_fail_all "the API/web stack did not start (evidence/_runtime-$JOB)" AC-54 AC-55 AC-56
fi
ac57
