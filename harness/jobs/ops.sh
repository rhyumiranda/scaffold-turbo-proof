#!/bin/bash
# Operations: AC-86, AC-87, AC-88, AC-89, AC-90, AC-96.
# Order: verdict-critical phases first, the long tail of AC-86 (documented test suites) last.
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/containers.sh"
provenance || exit 1
secrets_init
OPS="$HARNESS/infra/ops"
mkdir -p "$EV/AC-86" "$EV/AC-87" "$EV/AC-88" "$EV/AC-89" "$EV/AC-90" "$EV/AC-96"

back_to_target() { git -C "$WS" switch -q --detach "$TARGET_SHA" 2> /dev/null; [ "$(git -C "$WS" rev-parse HEAD)" = "$TARGET_SHA" ] && [ -z "$(git -C "$WS" status --porcelain --untracked-files=no)" ]; }

install_pg15() {
  sudo mkdir -p /etc/postgresql-common && echo 'create_main_cluster = false' | sudo tee /etc/postgresql-common/createcluster.conf || return 1
  sudo install -d /usr/share/postgresql-common/pgdg
  sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc || return 1
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
  sudo apt-get update || return 1
  local v='15.19-1.pgdg24.04+2'
  sudo apt-get install -y --no-install-recommends "postgresql-15=$v" "postgresql-client-15=$v" || return 1
  sudo apt-get install -y --no-install-recommends "postgresql-server-dev-15=$v" || echo "server-dev package unavailable; a pg_config shim will be used"
  if [ ! -x /usr/lib/postgresql/15/bin/pg_config ]; then
    mkdir -p "$WORK/pgshim"
    printf '#!/bin/sh\ncase "$1" in --bindir) echo /usr/lib/postgresql/15/bin;; --version) echo "PostgreSQL 15.19";; *) exit 1;; esac\n' > "$WORK/pgshim/pg_config"; chmod +x "$WORK/pgshim/pg_config"
    echo "$WORK/pgshim" > "$WORK/pgshim.path"
  fi
  /usr/lib/postgresql/15/bin/pg_dump --version
}

# ---------- setup ----------
ws_install || echo "install failed"
playwright_install || echo "playwright install failed"
ev_run "_setup-$JOB" pg15 -- install_pg15 || echo "pg15 install failed"
export PATH="/usr/lib/postgresql/15/bin:$PATH"
[ -f "$WORK/pgshim.path" ] && export PATH="$(cat "$WORK/pgshim.path"):$PATH"
ev_run "_infra-$JOB" stack-up -- ct_stack_up || echo "stack failed to start"
ev_run "_infra-$JOB" redis-plain -- ct_redis_plain_up || echo "plain redis failed"
ev_run "_infra-$JOB" tool-versions -- bash -c 'pg_config --version; pg_config --bindir; pg_dump --version; docker exec acc-pg postgres --version'

PGDB() { docker exec acc-pg psql -U postgres -d "$1" -Atc "$2"; }   # read-only SELECTs only
DBURL() { printf 'postgresql://postgres:%s@127.0.0.1:5432/%s' "$PG_PASSWORD" "$1"; }

# Create records through the API (not SQL): $1 = user, $2 = count
populate() {
  local tok i; tok="$(ct_token "$1")" || return 1
  for i in $(seq 1 "$2"); do
    curl -fsS -o /dev/null -X POST http://127.0.0.1:4100/v1/projects -H "authorization: Bearer $tok" -H 'content-type: application/json' -d "{\"name\":\"seed $1 $i\"}" || return 1
  done
}

# =====================================================================================================
# Phase 1 (AC-86): documented local setup, then the documented image builds
# =====================================================================================================
ok86=1; why86=""
ev_run AC-86 extract-blocks -- python3 "$OPS/extract-blocks.py" "$WS" "$WORK/ac86-blocks"
cp "$WORK/ac86-blocks/index.tsv" "$EV/AC-86/blocks-index.tsv"
declare -A blk_done
blk_find() { # pattern, file substring -> block number
  local n f
  while IFS=$'\t' read -r n f _; do
    [[ "$f" == *"$2"* ]] && grep -qF -- "$1" "$WORK/ac86-blocks/$n.sh" && { echo "$n"; return 0; }
  done < "$WORK/ac86-blocks/index.tsv"
  return 1
}
# run_block NUMBER [sed expression filling a documented placeholder]
run_block() {
  local n="$1" sub="${2:-}" meta; meta="$(awk -F'\t' -v n="$n" '$1==n{print $2":"$3}' "$WORK/ac86-blocks/index.tsv")"
  cp "$WORK/ac86-blocks/$n.sh" "$WORK/ac86-blocks/$n.run.sh"
  [ -n "$sub" ] && sed -i -e "$sub" "$WORK/ac86-blocks/$n.run.sh"
  diff "$WORK/ac86-blocks/$n.sh" "$WORK/ac86-blocks/$n.run.sh" > "$EV/AC-86/block-$n-placeholder-fill.diff"
  cp "$WORK/ac86-blocks/$n.sh" "$EV/AC-86/block-$n-as-documented.sh"
  blk_done[$n]=1
  ev_run AC-86 "block-$n-$(echo "$meta" | tr '/:' '__')" -- bash -e -o pipefail "$WORK/ac86-blocks/$n.run.sh" || { ok86=0; why86="$why86 block $n ($meta) exit $?;"; return 1; }
}
b_setup="$(blk_find 'pnpm format:check' docs/operations.md)"; b_smoke="$(blk_find 'health/ready' docs/operations.md)"
b_images="$(blk_find 'docker build -f apps/api/Dockerfile' docs/operations.md)"; b_recov="$(blk_find 'test:recovery' docs/operations.md)"
b_cache="$(blk_find 'TURBO_API' docs/operations.md)"; b_t1="$(blk_find 'pnpm check:budget' testing.md)"; b_t2="$(blk_find 'test:integration' testing.md)"
echo "blocks: setup=$b_setup smoke=$b_smoke images=$b_images recovery=$b_recov cache=$b_cache testing1=$b_t1 testing2=$b_t2" | tee "$EV/AC-86/block-map.txt"
for v in "$b_setup" "$b_smoke" "$b_images" "$b_recov" "$b_cache" "$b_t1" "$b_t2"; do [ -n "$v" ] || { ok86=0; why86="$why86 an expected documented block was not found;"; }; done

[ -n "$b_setup" ] && run_block "$b_setup"
[ -n "$b_images" ] && run_block "$b_images"

# =====================================================================================================
# Phase 2: stack from the documented images; documented smoke; seed data through the API
# =====================================================================================================
DB=ops_main_test
ct_db_create "$DB" > "$EV/AC-86/createdb.txt" 2>&1
ct_envfiles "$DB" > "$EV/AC-86/envfiles.txt" 2>&1
ev_run AC-86 stack-migrate -- ct_migrate acme-api-migrate || { ok86=0; why86="$why86 migrate;"; }
ev_run AC-86 stack-api -- ct_api_up acme-api || { ok86=0; why86="$why86 api container;"; }
ev_run AC-86 stack-web -- ct_web_up acme-web || { ok86=0; why86="$why86 web container;"; }
[ -n "$b_smoke" ] && run_block "$b_smoke"
ev_run AC-86 seed-via-api -- bash -c 'true'
for u in alice bob load1 load2; do ev_run AC-86 "seed-$u" -- populate "$u" 40 || { ok86=0; why86="$why86 seeding $u;"; }; done
PGDB "$DB" "select count(*) from projects" > "$EV/AC-86/seeded-count.txt"

# =====================================================================================================
# AC-88: recovery drill (criterion form) and an independent logical backup restored into a new Postgres
# =====================================================================================================
ok88=1; why88=""
( export DATABASE_URL="$(DBURL "$DB")"; export EV_ENV_NAMES="PG_BIN NODE_ENV DATABASE_URL"
  ev_run AC-88 test-recovery -- bash -c 'PG_BIN="$(pg_config --bindir)" NODE_ENV=test pnpm --filter @repo/api test:recovery' ) || { ok88=0; why88="$why88 test:recovery exit $(cat "$EV/AC-88/test-recovery.exit");"; }
ev_run AC-88 dump -- pg_dump -Fc -f "$WORK/ac88.dump" "$(DBURL "$DB")" || { ok88=0; why88="$why88 pg_dump;"; }
ev_run AC-88 restore-target-up -- bash -c "docker run -d --name acc-pg-restore --network $CT_NET --cpus=2 --memory=2g -e POSTGRES_PASSWORD='$PG_PASSWORD' '$IMG_PG' && for i in \$(seq 1 60); do docker exec acc-pg-restore pg_isready -h 127.0.0.1 -U postgres && sleep 2 && docker exec acc-pg-restore pg_isready -h 127.0.0.1 -U postgres && exit 0; sleep 1; done; exit 1" || { ok88=0; why88="$why88 restore container;"; }
ev_run AC-88 restore -- bash -c "docker exec acc-pg-restore createdb -U postgres restored && docker exec -i acc-pg-restore pg_restore -U postgres -d restored --no-owner --exit-on-error < '$WORK/ac88.dump'" || { ok88=0; why88="$why88 pg_restore;"; }
Q="select count(*)::text || ' ' || md5(string_agg(t::text, '' order by id)) from projects t"
src="$(PGDB "$DB" "$Q")"; dst="$(docker exec acc-pg-restore psql -U postgres -d restored -Atc "$Q")"
printf 'source:   %s\nrestored: %s\n' "$src" "$dst" | tee "$EV/AC-88/compare.txt"
[ -n "$src" ] && [ "$src" = "$dst" ] || { ok88=0; why88="$why88 hashes differ or empty ($src vs $dst);"; }
ev_run AC-88 docs-rpo-rto -- bash -c "grep -n 'Recovery point objective\|Recovery time objective\|owner:' docs/operations.md"
grep -q 'Recovery point objective' "$EV/AC-88/docs-rpo-rto.stdout" && grep -q 'Recovery time objective' "$EV/AC-88/docs-rpo-rto.stdout" && grep -q 'owner: ' "$EV/AC-88/docs-rpo-rto.stdout" || { ok88=0; why88="$why88 RPO/RTO placeholders with owner missing;"; }
docker rm -f acc-pg-restore > /dev/null 2>&1; rm -f "$WORK/ac88.dump"
if [ $ok88 = 1 ]; then verdict AC-88 PASS "test:recovery exits 0 with PostgreSQL 15 tools; independent pg_dump -Fc restored into a new postgres:15.15 gives identical count and md5 ($src); docs hold RPO/RTO placeholders with owner blanks"; else verdict AC-88 FAIL "${why88# }"; fi

# the documented recovery block (AC-86)
if [ -n "$b_recov" ]; then ( export DATABASE_URL="$(DBURL "$DB")"; EV_ENV_NAMES="DATABASE_URL" run_block "$b_recov" ) || true; fi
# AC-86 shared tail needs the original ok86/why86 values, which run_block set in a subshell; track by exit file instead
[ -n "$b_recov" ] && [ "$(cat "$EV/AC-86/block-$b_recov-"*.exit 2> /dev/null | head -1)" = 0 ] || { ok86=0; why86="$why86 recovery block;"; }

# =====================================================================================================
# AC-87: release, rollback and migration safety
# =====================================================================================================
ok87=1; why87=""
ev_run AC-87 docs-excerpt -- bash -c "sed -n '/^## Release order and rollback/,/^## Backup/p' docs/operations.md"
d="$EV/AC-87/docs-excerpt.stdout"
n1=$(grep -n '^1\. Build and push' "$d" | cut -d: -f1); n2=$(grep -n '^2\. Run the migrate image \*\*once\*\*' "$d" | cut -d: -f1)
n3=$(grep -n '^3\. Roll out the API' "$d" | cut -d: -f1); n4=$(grep -n '^4\. Roll out the web' "$d" | cut -d: -f1)
{ [ -n "$n1" ] && [ -n "$n2" ] && [ -n "$n3" ] && [ -n "$n4" ] && [ "$n1" -lt "$n2" ] && [ "$n2" -lt "$n3" ] && [ "$n3" -lt "$n4" ]; } || { ok87=0; why87="$why87 release order (build, migrate once, API, web) not documented;"; }
grep -q 'expand/contract' "$d" || { ok87=0; why87="$why87 expand/contract rule missing;"; }
grep -q 'Rollback reverses steps 4 and 3' "$d" && grep -q 'Never roll back a migration' "$d" || { ok87=0; why87="$why87 rollback rule missing;"; }
DB87=ops_rel_test
ct_db_create "$DB87" > "$EV/AC-87/createdb.txt" 2>&1; ct_envfiles "$DB87" > "$EV/AC-87/envfiles.txt" 2>&1
ev_run AC-87 v1-migrate -- ct_migrate acme-api-migrate || { ok87=0; why87="$why87 v1 migrate;"; }
ev_run AC-87 v1-api -- ct_api_up acme-api || { ok87=0; why87="$why87 v1 api;"; }
ev_run AC-87 v1-web -- ct_web_up acme-web || { ok87=0; why87="$why87 v1 web;"; }
ev_run AC-87 v1-data -- ct_exercise http://127.0.0.1:4100 "v1 data" || { ok87=0; why87="$why87 v1 exercise;"; }
EV_ENV_NAMES="WS BASE OUT NAME KC_USER KC_PASS RENAME" ev_run AC-87 v1-journey -- ct_journey "AC-87 v1" "$EV/AC-87/journey-v1" rename || { ok87=0; why87="$why87 v1 journey;"; }
unset EV_ENV_NAMES
ev_run AC-87 v1-schema -- bash -c "docker exec acc-pg psql -U postgres -d $DB87 -Atc \"select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_name='projects'\"; docker exec acc-pg psql -U postgres -d $DB87 -Atc 'select count(*) from projects'"
# v2 on a throwaway branch: additive migration plus code that writes the new column
git -C "$WS" switch -q -c throwaway/ac87-v2
ev_run AC-87 v2-patch -- python3 "$OPS/v2-patch.py" "$WS" || { ok87=0; why87="$why87 v2 patch failed;"; }
git -C "$WS" add -A
if git -C "$WS" diff --cached --quiet; then
  ok87=0; why87="$why87 v2 patch produced no change;"
else
  git -C "$WS" -c user.name=harness -c user.email=harness@invalid commit -qm "test: AC-87 v2 (additive migration)" || { ok87=0; why87="$why87 v2 commit failed;"; }
fi
git -C "$WS" show --stat --patch HEAD > "$EV/AC-87/v2.diff"
ev_run AC-87 build-migrate-v2 -- docker build --progress=plain -f apps/api/Dockerfile --target migrate -t acme-api-migrate:v2 . || { ok87=0; why87="$why87 v2 migrate build;"; }
ev_run AC-87 build-api-v2 -- docker build --progress=plain -f apps/api/Dockerfile --target runtime -t acme-api:v2 . || { ok87=0; why87="$why87 v2 api build;"; }
back_to_target || { ok87=0; why87="$why87 workspace not back on target commit;"; }
git -C "$WS" branch -q -D throwaway/ac87-v2
ev_run AC-87 v2-migrate -- ct_migrate acme-api-migrate:v2 || { ok87=0; why87="$why87 v2 migrate exit;"; }
ev_run AC-87 v2-schema -- bash -c "docker exec acc-pg psql -U postgres -d $DB87 -Atc \"select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_name='projects'\""
grep -q renamed_at "$EV/AC-87/v2-schema.stdout" || { ok87=0; why87="$why87 v2 column missing;"; }
ev_run AC-87 v2-api -- ct_api_up acme-api:v2 || { ok87=0; why87="$why87 v2 api not ready;"; }
ev_run AC-87 v2-exercise -- ct_exercise http://127.0.0.1:4100 "v2" || { ok87=0; why87="$why87 v2 exercise;"; }
docker logs acc-api > "$EV/AC-87/api-v2.log" 2>&1
ev_run AC-87 v2-renamed-at -- bash -c "docker exec acc-pg psql -U postgres -d $DB87 -Atc 'select count(*) from projects where renamed_at is not null'"
[ "$(cat "$EV/AC-87/v2-renamed-at.stdout")" -ge 1 ] 2> /dev/null || { ok87=0; why87="$why87 v2 code did not write the new column;"; }
# roll the API back to v1 with the schema at v2
ev_run AC-87 rollback-api-v1 -- ct_api_up acme-api || { ok87=0; why87="$why87 v1 api not ready on v2 schema;"; }
ev_run AC-87 rollback-exercise -- ct_exercise http://127.0.0.1:4100 "v1-on-v2-schema" || { ok87=0; why87="$why87 v1 exercise on v2 schema;"; }
EV_ENV_NAMES="WS BASE OUT NAME KC_USER KC_PASS RENAME" ev_run AC-87 rollback-journey -- ct_journey "AC-87 rollback" "$EV/AC-87/journey-rollback" rename || { ok87=0; why87="$why87 journey on v2 schema;"; }
unset EV_ENV_NAMES
f5=$(jq '.appResponses5xx | length' "$EV/AC-87/journey-rollback/result.json" 2> /dev/null || echo missing); [ "$f5" = 0 ] || { ok87=0; why87="$why87 5xx in rollback journey=$f5;"; }
docker logs acc-api > "$EV/AC-87/api-v1-after-rollback.log" 2>&1
errl=$(grep -c '"level":"error"' "$EV/AC-87/api-v1-after-rollback.log"); s5=$(grep -cE '"status":5[0-9][0-9]' "$EV/AC-87/api-v1-after-rollback.log")
echo "v1 after rollback: error-level log lines=$errl status>=500 lines=$s5" | tee "$EV/AC-87/rollback-log-summary.txt"
[ "$errl" = 0 ] && [ "$s5" = 0 ] || { ok87=0; why87="$why87 errors in v1 log after rollback (error=$errl 5xx=$s5);"; }
if [ $ok87 = 1 ]; then verdict AC-87 PASS "docs state release order, expand/contract and rollback rules; migrate v2 (nullable column) exit 0, API v2 works, API v1 rolled back onto the v2 schema serves list/create/rename (API and browser) with 0 5xx and 0 error log lines"; else verdict AC-87 FAIL "${why87# }"; fi

# =====================================================================================================
# AC-89: incident triage and secret rotation docs, symptoms observed on the containers
# =====================================================================================================
ok89=1; why89=""
ev_run AC-89 docs-check -- python3 - "$WS/docs/operations.md" <<'PY'
import re, sys
t = open(sys.argv[1]).read()
def table(title):
    m = re.search(r'^## ' + title + r'\n(.*?)(?=^## |\Z)', t, re.M | re.S)
    rows = [[c.strip() for c in l.strip().strip('|').split('|')] for l in m.group(1).split('\n') if l.startswith('|')][2:]
    return rows
bad = []
tri = table('Incident triage')
for need in ('Database down', 'Redis (web sessions) down', 'Identity provider down', 'API overloaded'):
    rows = [r for r in tri if r[0].lower().startswith(need.lower())]
    ok = rows and len(rows[0]) >= 4 and all(c for c in rows[0][:4])
    print(('OK   ' if ok else 'MISSING ') + need);
    if not ok: bad.append(need)
rot = table('Secret rotation')
for need in ('DATABASE_URL', 'AUTH_CLIENT_SECRET', 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY', 'AUTH_REDIS_URL', 'OTLP'):
    rows = [r for r in rot if need in r[0]]
    ok = rows and len(rows[0]) >= 2 and len(rows[0][1]) > 40
    print(('OK   ' if ok else 'MISSING ') + 'rotation ' + need)
    if not ok: bad.append('rotation ' + need)
sys.exit(1 if bad else 0)
PY
[ "$(cat "$EV/AC-89/docs-check.exit")" = 0 ] || { ok89=0; why89="$why89 docs lack a scenario or rotation row;"; }
DB89=ops_incident_test
ct_db_create "$DB89" > "$EV/AC-89/createdb.txt" 2>&1; ct_envfiles "$DB89" > "$EV/AC-89/envfiles.txt" 2>&1
ct_migrate acme-api-migrate > "$EV/AC-89/migrate.txt" 2>&1
outage() { # scenario
  WS="$WS" OUT="$EV/AC-89/$1" SCENARIO="$1" node "$OPS/outage.mjs"
}
export EV_ENV_NAMES="WS OUT SCENARIO KC_USER_PASSWORD KC_ACME_CLI_SECRET"
ev_run AC-89 base-up -- bash -c 'true'
ct_api_up acme-api > "$EV/AC-89/api-up-1.txt" 2>&1; ct_web_up acme-web > "$EV/AC-89/web-up-1.txt" 2>&1
ev_run AC-89 scenario-db -- outage db || { ok89=0; why89="$why89 DB-down symptoms;"; }
ev_run AC-89 scenario-redis -- outage redis || { ok89=0; why89="$why89 session-Redis-down symptoms;"; }
CT_API_EXTRA=$'LIMITER_MODE=redis\nLIMITER_REDIS_URL=rediss://acc-redis:6380\nLIMITER_NAMESPACE=acc-api' ct_envfiles "$DB89" > /dev/null
ct_api_up acme-api > "$EV/AC-89/api-up-limiter.txt" 2>&1
ev_run AC-89 scenario-limiter -- outage limiter || { ok89=0; why89="$why89 limiter-Redis-down symptoms;"; }
ct_envfiles "$DB89" > /dev/null; ct_api_up acme-api > "$EV/AC-89/api-up-2.txt" 2>&1
ev_run AC-89 scenario-idp -- outage idp || { ok89=0; why89="$why89 IdP-down symptoms;"; }
# API overload: MAX_IN_FLIGHT=2, RATE_LIMIT=5, metrics exported to a collector that shares the API network namespace (loopback http is the only http allowed)
mkdir -p "$EV/AC-89/otel"; chmod 777 "$EV/AC-89/otel"
cat > "$CT/otel.yaml" <<'Y'
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
exporters:
  file:
    path: /out/otel.jsonl
service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [file]
Y
chmod 644 "$CT/otel.yaml"
CT_API_EXTRA=$'MAX_IN_FLIGHT=2\nRATE_LIMIT=5\nTELEMETRY_EXPORTER=otlp\nOTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318' ct_envfiles "$DB89" > /dev/null
ct_api_up acme-api > "$EV/AC-89/api-up-overload.txt" 2>&1
docker run -d --name acc-otel --network container:acc-api --cpus=1 --memory=512m -v "$CT/otel.yaml:/etc/otel.yaml:ro" -v "$EV/AC-89/otel:/out" "$IMG_OTEL" --config /etc/otel.yaml > /dev/null
overload() {
  local a b i
  a="$(ct_token alice)"; b="$(ct_token bob)"
  python3 - <<'PY' &
import socket, time
ss = []
for i in range(2):
    s = socket.create_connection(('127.0.0.1', 4100))
    s.sendall(b'POST /v1/projects HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"na'); ss.append(s)
time.sleep(6)
for s in ss: s.close()
PY
  sleep 1.5
  echo "in-flight full: GET /v1/projects:"; curl -s -o /dev/null -D - -w 'HTTP %{http_code}\n' "http://127.0.0.1:4100/v1/projects?limit=20" -H "authorization: Bearer $a" | grep -iE '^(HTTP|retry-after)'
  echo "in-flight full: live:"; curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:4100/health/live
  wait; sleep 1
  echo "after release:"; curl -s -o /dev/null -w 'HTTP %{http_code}\n' "http://127.0.0.1:4100/v1/projects?limit=20" -H "authorization: Bearer $a"
  echo "rate limit (5 per window) for bob:"
  for i in 1 2 3 4 5 6 7; do curl -s -o /dev/null -D - -w 'HTTP %{http_code}\n' "http://127.0.0.1:4100/v1/projects?limit=20" -H "authorization: Bearer $b" | grep -iE '^(HTTP|retry-after)' | tr -d '\r' | tr '\n' ' '; echo; done
  echo "liveness while limited:"; curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:4100/health/live
}
unset EV_ENV_NAMES
ev_run AC-89 scenario-overload -- overload
for i in $(seq 1 20); do grep -q 'http.server.overloaded' "$EV/AC-89/otel/otel.jsonl" 2> /dev/null && break; sleep 5; done
docker stop -t 15 acc-api > /dev/null 2>&1; sleep 3
python3 - "$EV/AC-89/otel/otel.jsonl" > "$EV/AC-89/overload-metric.txt" 2>&1 <<'PY'
import json, sys
over = []
try:
    for line in open(sys.argv[1]):
        for rm in json.loads(line).get('resourceMetrics', []):
            for sm in rm.get('scopeMetrics', []):
                for m in sm.get('metrics', []):
                    if m['name'] == 'http.server.overloaded':
                        over += [float(p.get('asInt') or p.get('asDouble') or 0) for p in m.get('sum', {}).get('dataPoints', [])]
except FileNotFoundError:
    pass
print('http.server.overloaded datapoints:', over)
sys.exit(0 if over and max(over) > 0 else 1)
PY
mo=$?
o="$EV/AC-89/scenario-overload.stdout"
{ grep -A4 'in-flight full: GET' "$o" | grep -q 'HTTP 503' && grep -A4 'in-flight full: GET' "$o" | grep -qi 'retry-after: 1'; } || { ok89=0; why89="$why89 overload 503 with Retry-After: 1 not seen;"; }
grep -A1 'in-flight full: live' "$o" | grep -q 'HTTP 200' || { ok89=0; why89="$why89 liveness not 200 under overload;"; }
grep -A1 'after release' "$o" | grep -q 'HTTP 200' || { ok89=0; why89="$why89 no recovery after overload;"; }
grep -iE '429.*retry-after' "$o" > /dev/null || { ok89=0; why89="$why89 no 429 with Retry-After;"; }
[ $mo = 0 ] || { ok89=0; why89="$why89 http.server.overloaded metric not exported;"; }
docker rm -f acc-otel > /dev/null 2>&1
if [ $ok89 = 1 ]; then verdict AC-89 PASS "docs cover DB, session Redis, IdP, API overload (symptoms, first action, recovery) and rotation for all 5 secrets; every documented symptom observed on the containers (DB, session Redis, limiter Redis, IdP, overload 503/429 and the exported metric) with automatic recovery"; else verdict AC-89 FAIL "${why89# }"; fi

# =====================================================================================================
# AC-96: k6 50 VUs for 3 minutes, RSS sampled every 10 s, plus the repo's test:load
# =====================================================================================================
ok96=1; why96=""
DB96=ops_load_test
ct_db_create "$DB96" > "$EV/AC-96/createdb.txt" 2>&1
CT_API_EXTRA="RATE_LIMIT=100000" ct_envfiles "$DB96" > "$EV/AC-96/envfiles.txt" 2>&1
ct_migrate acme-api-migrate > "$EV/AC-96/migrate.txt" 2>&1
ev_run AC-96 api-up -- ct_api_up acme-api || { ok96=0; why96="$why96 api not ready;"; }
mkdir -p "$CT/k6"; chmod 755 "$CT/k6"
{ printf '['; for n in 1 2 3 4 5 6 7 8 9 10; do [ $n -gt 1 ] && printf ','; printf '"%s"' "$(ct_token "load$n")"; done; printf ']'; } > "$CT/k6/tokens.json"; chmod 644 "$CT/k6/tokens.json"
[ "$(jq 'length' "$CT/k6/tokens.json")" = 10 ] || { ok96=0; why96="$why96 could not mint 10 tokens;"; }
chmod 777 "$EV/AC-96"
( for i in $(seq 0 19); do echo "$(date -u +%FT%TZ) t=$((i * 10))s $(docker exec acc-api grep VmRSS /proc/1/status | tr -s ' \t' ' ')"; sleep 10; done ) > "$EV/AC-96/rss.txt" 2>&1 &
sampler=$!
ev_run AC-96 k6 -- docker run --rm --name acc-k6 --network "$CT_NET" --cpus=2 --memory=2g -e BASE=http://acc-api:4100 -v "$OPS:/scripts:ro" -v "$CT/k6:/secrets:ro" -v "$EV/AC-96:/out" "$IMG_K6" run --quiet --summary-export /out/k6-summary.json /scripts/k6-smoke.js
wait "$sampler"
docker logs acc-api > "$EV/AC-96/api.log" 2>&1
python3 - "$EV/AC-96/k6-summary.json" "$EV/AC-96/rss.txt" > "$EV/AC-96/evaluation.txt" <<'PY'
import json, re, sys
s = json.load(open(sys.argv[1]))['metrics']
f = s['http_req_failed']; rate = f.get('value', f.get('rate')); p95 = s['http_req_duration']['p(95)']; n = s['http_reqs']['count']
rss = {}
for l in open(sys.argv[2]):
    m = re.search(r't=(\d+)s VmRSS: (\d+) kB', l)
    if m: rss[int(m.group(1))] = int(m.group(2))
r1, r3 = rss.get(60), rss.get(180)
ch = None if not (r1 and r3) else 100.0 * (r3 - r1) / r1
print(f'requests={n} error_rate={rate} p95_ms={p95:.1f} rss_t60={r1}kB rss_t180={r3}kB change={ch}%')
ok = n > 1000 and rate < 0.001 and p95 < 300 and ch is not None and abs(ch) <= 20
print('PASS' if ok else 'FAIL'); sys.exit(0 if ok else 1)
PY
ev96=$?; cat "$EV/AC-96/evaluation.txt"
[ $ev96 = 0 ] || { ok96=0; why96="$why96 $(head -1 "$EV/AC-96/evaluation.txt");"; }
tokL="$(ct_token load1)"
( export LOAD_URL='http://127.0.0.1:4100/v1/projects?limit=20' LOAD_BEARER="$tokL" LOAD_REQUESTS=2000 LOAD_CONCURRENCY=20 LOAD_P95_MS=300 LOAD_ERROR_RATE=0.001
  export EV_ENV_NAMES="LOAD_URL LOAD_BEARER LOAD_REQUESTS LOAD_CONCURRENCY LOAD_P95_MS LOAD_ERROR_RATE"
  ev_run AC-96 test-load -- pnpm --filter @repo/api test:load ) || { ok96=0; why96="$why96 test:load exit $(cat "$EV/AC-96/test-load.exit");"; }
rm -rf "$CT/k6"
if [ $ok96 = 1 ]; then verdict AC-96 PASS "k6 50 VUs x 3 min (80% list, 20% create, 10 Keycloak users, RATE_LIMIT=100000): $(sed -n 1p "$EV/AC-96/evaluation.txt"); test:load exits 0"; else verdict AC-96 FAIL "${why96# }"; fi

# =====================================================================================================
# AC-90: remove the Projects example by the documented steps, then the AC-12 sequence
# =====================================================================================================
ok90=1; why90=""
docker rm -f acc-api acc-web > /dev/null 2>&1
git -C "$WS" switch -q -c throwaway/ac90-remove-example
ev_run AC-90 docs-steps -- bash -c "grep -c 'git rm -r' docs/replacing-the-example.md; grep -n '^## ' docs/replacing-the-example.md"
grep -q 'git rm -r' "$WS/docs/replacing-the-example.md" || { ok90=0; why90="$why90 no removal steps documented;"; }
# Step 1: the documented git rm block, verbatim
ev_run AC-90 step1-git-rm -- bash -e -c "$(awk '/^```bash/{f=1;next} /^```/{if(f){exit}} f' <(sed -n '/^## 1\./,/^## 2\./p' "$WS/docs/replacing-the-example.md"))" || { ok90=0; why90="$why90 step 1;"; }
ev_run AC-90 step2-edits -- python3 "$OPS/remove-example.py" "$WS" || { ok90=0; why90="$why90 step 2 edits;"; }
ev_run AC-90 step3-generate -- pnpm contract:generate || { ok90=0; why90="$why90 contract:generate;"; }
ev_run AC-90 step3-check-before-accept -- pnpm contract:check   # the doc says removed operations are reported as breaking
ev_run AC-90 step3-accept -- bash -c 'cp apps/api/openapi.json apps/api/contracts/accepted.openapi.json && cp apps/api/openapi.json packages/api-client/contract/accepted.openapi.json'
ev_run AC-90 step4-delete-migration -- git rm -r -q apps/api/prisma/migrations/0001_projects || { ok90=0; why90="$why90 step 4;"; }
git -C "$WS" add -A
git -C "$WS" -c user.name=harness -c user.email=harness@invalid commit -qm "test: AC-90 remove Projects example"
git -C "$WS" show --stat HEAD > "$EV/AC-90/removal.stat"
for c in check:workspace boundaries format:check check:secrets check:docs lint check:arch typecheck build test:unit contract:check check:budget; do
  l="${c//:/_}"
  ev_run AC-90 "ac12-$l" -- pnpm "$c" || { ok90=0; why90="$why90 $c=exit$?;"; }
done
back_to_target || { ok90=0; why90="$why90 workspace not back on target commit;"; }
git -C "$WS" branch -q -D throwaway/ac90-remove-example
if [ $ok90 = 1 ]; then verdict AC-90 PASS "documented removal steps followed on a throwaway branch (no-feature, unreleased path); all 12 AC-12 commands exit 0 afterwards"; else verdict AC-90 FAIL "${why90# }"; fi

# =====================================================================================================
# AC-86 tail: the remaining documented blocks and command lists
# =====================================================================================================
back_to_target || echo "workspace not clean on target commit"
docker rm -f acc-api acc-web > /dev/null 2>&1
[ -n "$b_cache" ] && run_block "$b_cache" 's/<from secret store>/placeholder-not-a-secret/'
[ -n "$b_t1" ] && run_block "$b_t1"
DB_E2E="$(DBURL ops_e2e_test)"; ct_db_create ops_e2e_test > /dev/null 2>&1
export TEST_REDIS_URL=redis://127.0.0.1:6379
# The fill names the exported variable, so the password never lands in the saved diff.
[ -n "$b_t2" ] && ( export DB_E2E; run_block "$b_t2" "s#'<disposable-test-database-url>'#\"\$DB_E2E\"#g" ) || true
# run_block ran in a subshell above, so re-derive the verdict inputs from the exit files
blocks_failed=""
while IFS=$'\t' read -r n f line lang kind shellk; do
  if [ "$kind" = target ] || [ "$shellk" != shell ]; then continue; fi
  ec="$(cat "$EV/AC-86/block-$n-"*.exit 2> /dev/null | head -1)"
  [ "$ec" = 0 ] || blocks_failed="$blocks_failed $n($f:$line exit=${ec:-notrun})"
done < "$WORK/ac86-blocks/index.tsv"
[ -z "$blocks_failed" ] || { ok86=0; why86="$why86 blocks not passing:$blocks_failed;"; }

# Inline command lists (AGENTS.md files and the apps' operations guides): each command must appear verbatim in the doc.
inline() { # FILE CWD COMMAND...   FILE is relative to the repo
  local f="$1" cwd="$2"; shift 2; local cmd="$*"
  grep -qF -- "\`$cmd\`" "$WS/$f" || { echo "NOT IN DOC: $f: $cmd" >> "$EV/AC-86/inline-missing.txt"; ok86=0; why86="$why86 '$cmd' not found in $f;"; return 1; }
  ev_run AC-86 "inline-$(echo "$f $cmd" | tr -c 'A-Za-z0-9\n' '_' | cut -c1-70)" "$WS/$cwd" -- bash -e -o pipefail -c "$cmd" || { ok86=0; why86="$why86 [$f] $cmd;"; return 1; }
}
for c in 'pnpm check:workspace' 'pnpm boundaries' 'pnpm lint' 'pnpm check:arch' 'pnpm typecheck' 'pnpm build' 'pnpm test:unit' 'pnpm contract:check'; do inline AGENTS.md . "$c"; done
for c in 'pnpm check:arch' 'pnpm check:secrets' 'pnpm check:docs' 'pnpm build'; do inline apps/api/AGENTS.md apps/api "$c"; done
for c in 'pnpm lint' 'pnpm test:unit' 'pnpm check:docs' 'pnpm typecheck' 'pnpm build' 'pnpm check:budget' 'pnpm test:runtime'; do inline apps/web/AGENTS.md apps/web "$c"; done
export DATABASE_URL_SAVE=""
for c in 'pnpm install --frozen-lockfile' 'pnpm lint' 'pnpm check:arch' 'pnpm typecheck' 'pnpm build'; do inline apps/api/docs/operations.md apps/api "$c"; done
# The API runbook sets these four before migrating and starting (documented names); TLS issuer from the local edge.
api_runbook_env() {
  export DATABASE_URL="$(DBURL ops_runbook_test)" AUTH_ISSUER="$IDP_ORIGIN/realms/acme" AUTH_AUDIENCE=acme-api AUTH_JWKS_URL="$IDP_ORIGIN/realms/acme/protocol/openid-connect/certs" NODE_EXTRA_CA_CERTS="$CT/certs/ca.crt" PORT=4106
  export EV_ENV_NAMES="DATABASE_URL AUTH_ISSUER AUTH_AUDIENCE AUTH_JWKS_URL NODE_EXTRA_CA_CERTS PORT"
}
ct_db_create ops_runbook_test > /dev/null 2>&1
( api_runbook_env
  for c in 'pnpm migrate' 'pnpm contract' 'pnpm contract:check' 'pnpm contract:compat'; do inline apps/api/docs/operations.md apps/api "$c"; done
  # pnpm start never returns: start it, require readiness, stop it
  grep -qF -- '`pnpm start`' "$WS/apps/api/docs/operations.md" || exit 1
  ( cd "$WS/apps/api" && pnpm start > "$EV/AC-86/inline-api-pnpm-start.stdout" 2> "$EV/AC-86/inline-api-pnpm-start.stderr" ) & spid=$!
  rdy=1; for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4106/health/ready)" = 200 ] && { rdy=0; break; }; sleep 1; done
  pkill -TERM -P "$spid" 2> /dev/null; kill -TERM "$spid" 2> /dev/null; wait "$spid" 2> /dev/null
  echo "api pnpm start ready=$rdy" > "$EV/AC-86/inline-api-pnpm-start.result"
  exit $rdy ) || { ok86=0; why86="$why86 api runbook (migrate/contract/start);"; }
unset EV_ENV_NAMES
( export DATABASE_URL="$(DBURL ops_api_it_test)"; ct_db_create ops_api_it_test > /dev/null 2>&1
  for c in 'NODE_ENV=test pnpm test:unit' 'NODE_ENV=test pnpm test:integration' 'NODE_ENV=test pnpm test:runtime'; do EV_ENV_NAMES=DATABASE_URL inline apps/api/docs/operations.md apps/api "$c"; done ) || { ok86=0; why86="$why86 api test commands;"; }
for t in runtime migrate; do inline apps/api/docs/operations.md . "docker build -f apps/api/Dockerfile --target $t -t app-$t ."; done
( export PORT=3106; API_BASE_URL=https://api.example.invalid
  grep -qF -- '`API_BASE_URL=https://api.example.invalid pnpm start`' "$WS/apps/web/docs/operations.md" || exit 1
  ( cd "$WS/apps/web" && API_BASE_URL=https://api.example.invalid pnpm start > "$EV/AC-86/inline-web-pnpm-start.stdout" 2> "$EV/AC-86/inline-web-pnpm-start.stderr" ) & spid=$!
  rdy=1; for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3106/healthz)" = 200 ] && { rdy=0; break; }; sleep 1; done
  pkill -TERM -P "$spid" 2> /dev/null; kill -TERM "$spid" 2> /dev/null; wait "$spid" 2> /dev/null
  echo "web pnpm start healthz ready=$rdy" > "$EV/AC-86/inline-web-pnpm-start.result"; exit $rdy ) || { ok86=0; why86="$why86 web pnpm start;"; }
ev_run AC-86 tracked-files-unchanged -- git status --porcelain=v1 --untracked-files=no
[ ! -s "$EV/AC-86/tracked-files-unchanged.stdout" ] || { ok86=0; why86="$why86 tracked files changed;"; }
if [ $ok86 = 1 ]; then verdict AC-86 PASS "every fenced block in the docs (and every command in the AGENTS.md and API/web operations guides) exits 0 as written; only documented placeholders were filled (diffs in block-*-placeholder-fill.diff)"; else verdict AC-86 FAIL "${why86# }"; fi

ct_redact > "$EV/_redaction-$JOB.txt" 2>&1
exit 0
