#!/bin/bash
# Data correctness: AC-46, AC-47, AC-48, AC-49, AC-50, AC-51, AC-52, AC-58.
. "$(dirname "$0")/../lib/dro.sh"
provenance || exit 1
secrets_init
dro_guard AC-46 AC-47 AC-48 AC-49 AC-50 AC-51 AC-52 AC-58

export API_PORT=4101 WEB_PORT=3101 WEB_NS=data
export KC_ISSUER="http://localhost:8080/realms/acme"
export DRO_COMPOSE="$HARNESS/infra/data/compose.yaml"
SETUP="_setup-$JOB"
OWNED="AC-46 AC-47 AC-48 AC-49 AC-50 AC-51 AC-52 AC-58"

# ---------- services, install, build ----------
ev_run "$SETUP" infra-start -- bash -c 'cd "$HARNESS/infra" && docker compose up -d postgres redis keycloak'
( docker pull -q "grafana/k6:1.3.0@sha256:3ddc8b1a33a2c3d8edc6e99b6a762ae36cba08788463458f5e6a7703e14eb77d" > "$RT/k6-pull.log" 2>&1 ) &
dro_prepare || { dro_fail_all "setup failed: install, build or browser install (evidence/$SETUP)" $OWNED; exit 0; }
infra_up postgres redis keycloak || { dro_fail_all "setup failed: PostgreSQL, Redis or Keycloak did not become healthy" $OWNED; exit 0; }
toxi_start "$DRO_COMPOSE" || { dro_fail_all "setup failed: Toxiproxy did not start" $OWNED; exit 0; }
toxi_proxy pg 127.0.0.1:15432 127.0.0.1:5432 && toxi_proxy api 127.0.0.1:14100 "127.0.0.1:$API_PORT" || { dro_fail_all "setup failed: Toxiproxy proxies" $OWNED; exit 0; }
export PGC="$(docker compose -f "$HARNESS/infra/compose.yaml" ps -q postgres)"
kc_wait || { dro_fail_all "setup failed: Keycloak token endpoint did not answer" $OWNED; exit 0; }
echo "services up: postgres=$PGC"

migrate_db() { # migrate_db AC label db   create (if new) and migrate a disposable database through the migration runner (prisma migrate deploy)
  ev_run "$1" "create-$2" -- docker exec "$PGC" createdb -U postgres "$3" || return 1
  export DATABASE_URL="$(dro_url "$3")" NODE_ENV=test EV_ENV_NAMES="DATABASE_URL NODE_ENV"
  ev_run "$1" "$2" -- pnpm migrate
}
section() { awk -v s="## $2" '$0 == s {f=1; next} /^## /{f=0} f' "$1"; } # section <snapshot> <name>
node_scripts() { export OUT="$EV/$1"; mkdir -p "$OUT"; export WS WEB_URL="http://localhost:$WEB_PORT" API_URL="http://127.0.0.1:$API_PORT" TOXI_URL KC_ISSUER KC_ACME_CLI_SECRET KC_USER_PASSWORD API_LOG DB_PROXY OUT; export EV_ENV_NAMES="WS WEB_URL API_URL TOXI_URL KC_ISSUER KC_ACME_CLI_SECRET KC_USER_PASSWORD API_LOG DB_PROXY OUT"; }

# ---------- AC-46 ----------
ac46() {
  local ac=AC-46 db=ac46_test ok=1 why=""
  migrate_db $ac migrate-1 $db; local r1=$?
  dro_psql_ev $ac dt-after-1 $db '\dt'
  dro_snapshot $ac snapshot-1 $db xmin
  ev_run $ac migrate-2 -- pnpm migrate; local r2=$?
  dro_snapshot $ac snapshot-2 $db xmin
  local base; base="$(git -C "$WS" rev-parse HEAD)"
  git -C "$WS" switch -q -c throwaway/ac46
  # The first Prisma migration replaces migrations/001-projects.sql of the earlier runner.
  printf '\n-- AC-46 harness edit: a comment appended to an applied migration\n' >> "$WS/apps/api/prisma/migrations/0001_projects/migration.sql"
  git -C "$WS" add -A && git -C "$WS" -c user.name=harness -c user.email=harness@invalid commit -qm "test: AC-46 throwaway edit of an applied migration"
  git -C "$WS" show --stat --patch HEAD > "$EV/$ac/throwaway.diff"
  ev_run $ac migrate-edited -- pnpm migrate; local rE=$?
  dro_snapshot $ac snapshot-edited $db xmin
  git -C "$WS" switch -q --detach "$TARGET_SHA" && git -C "$WS" branch -q -D throwaway/ac46 || { ok=0; why="$why could not return to the target commit;"; }
  [ "$(git -C "$WS" rev-parse HEAD)" = "$TARGET_SHA" ] || { ok=0; why="$why HEAD is not the target commit after the throwaway;"; }
  local files; files="$(ls "$WS"/apps/api/prisma/migrations/*/migration.sql | wc -l)"
  local rows; rows="$(section "$EV/$ac/snapshot-1.stdout" ledger | grep -c .)"
  [ "$r1" = 0 ] || { ok=0; why="$why first run exit $r1;"; }
  [ "$rows" = "$files" ] && [ "$rows" -ge 1 ] || { ok=0; why="$why ledger rows=$rows vs $files migration files;"; }
  section "$EV/$ac/snapshot-1.stdout" tables | grep -qx projects || { ok=0; why="$why projects table missing;"; }
  [ "$r2" = 0 ] || { ok=0; why="$why second run exit $r2;"; }
  cmp -s "$EV/$ac/snapshot-1.stdout" "$EV/$ac/snapshot-2.stdout" || { ok=0; why="$why second run changed schema or ledger rows;"; }
  [ "$rE" != 0 ] || { ok=0; why="$why edited migration was accepted (exit 0);"; }
  cat "$EV/$ac/migrate-edited.stdout" "$EV/$ac/migrate-edited.stderr" | grep -qi 'checksum mismatch' || { ok=0; why="$why edited run did not name a checksum mismatch;"; }
  cat "$EV/$ac/migrate-edited.stdout" "$EV/$ac/migrate-edited.stderr" | grep -q '0001_projects' || { ok=0; why="$why edited run did not name the migration;"; }
  cmp -s "$EV/$ac/snapshot-1.stdout" "$EV/$ac/snapshot-edited.stdout" || { ok=0; why="$why edited run changed the database;"; }
  tracked_clean $ac status-after || { ok=0; why="$why tracked files changed;"; }
  if [ $ok = 1 ]; then verdict $ac PASS "empty DB -> schema + $rows ledger row(s); 2nd run exit 0 with identical schema, ledger and row versions; edited 0001_projects/migration.sql -> exit $rE naming the checksum mismatch, database unchanged"; else verdict $ac FAIL "${why# }"; fi
}

# ---------- AC-47 ----------
ac47() {
  local ac=AC-47 ok=1 why="" i
  dro_snapshot $ac baseline ac46_test
  local want; want="$(section "$EV/$ac/baseline.stdout" ledger | grep -c .)"
  for i in 1 2 3 4 5; do
    local db="ac47_${i}_test"
    ev_run $ac create-$i -- docker exec "$PGC" createdb -U postgres "$db"
    export DATABASE_URL="$(dro_url "$db")" NODE_ENV=test EV_ENV_NAMES="DATABASE_URL NODE_ENV"
    ev_run $ac run-$i -- bash "$DRO_DIR/par-migrate.sh" "$EV/$ac/run-$i"
    local a b; a="$(sed -n 's/^a=//p' "$EV/$ac/run-$i.stdout")"; b="$(sed -n 's/^b=//p' "$EV/$ac/run-$i.stdout")"
    dro_snapshot $ac snapshot-$i $db
    if [ "$a" = 0 ] && [ "$b" = 0 ]; then :
    elif { [ "$a" = 0 ] && [ "$b" != 0 ] || [ "$b" = 0 ] && [ "$a" != 0 ]; } && cat "$EV/$ac"/run-$i-?.out "$EV/$ac"/run-$i-?.err | grep -Eqi 'lock|in progress'; then :
    else ok=0; why="$why run $i exits a=$a b=$b without a lock message;"; fi
    cmp -s "$EV/$ac/baseline.stdout" "$EV/$ac/snapshot-$i.stdout" || { ok=0; why="$why run $i schema/ledger differs from a single-run database;"; }
    [ "$(section "$EV/$ac/snapshot-$i.stdout" ledger | grep -c .)" = "$want" ] || { ok=0; why="$why run $i ledger rows != $want;"; }
  done
  if [ $ok = 1 ]; then verdict $ac PASS "5/5 simultaneous pairs of pnpm migrate: both exit 0 or one is refused with a lock message; schema, constraints, indexes and ledger identical to the single-run database"; else verdict $ac FAIL "${why# }"; fi
}

# ---------- AC-48 ----------
ac48() {
  local ac=AC-48 db=ac48_test ok=1 why="" f="$EV/AC-48"
  migrate_db $ac migrate $db || { verdict $ac FAIL "could not migrate the disposable database"; return; }
  dro_psql_ev $ac constraints $db "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='projects'::regclass ORDER BY conname"
  dro_psql_ev $ac describe $db '\d projects'
  dro_psql_ev $ac not-null $db "SELECT attname FROM pg_attribute WHERE attrelid='projects'::regclass AND attnum>0 AND NOT attisdropped AND attnotnull ORDER BY attname"
  dro_psql_ev $ac index $db "SELECT indexdef FROM pg_indexes WHERE tablename='projects' AND indexname='projects_owner_order'"
  grep -qE 'PRIMARY KEY \(id\)' "$f/constraints.stdout" || { ok=0; why="$why no primary key;"; }
  grep -qE 'char_length\(owner_id\) >= 1.*char_length\(owner_id\) <= 200' "$f/constraints.stdout" || { ok=0; why="$why no owner length check;"; }
  grep -qE 'char_length\(name\) >= 1.*char_length\(name\) <= 100' "$f/constraints.stdout" || { ok=0; why="$why no name length check;"; }
  grep -qE 'name = btrim\(name\)' "$f/constraints.stdout" || { ok=0; why="$why no name trim check;"; }
  grep -qE 'version >= 1' "$f/constraints.stdout" || { ok=0; why="$why no version positivity check;"; }
  for col in id owner_id name version created_at; do grep -qx "$col" "$f/not-null.stdout" || { ok=0; why="$why $col nullable;"; }; done
  grep -q 'owner_id, created_at DESC, id DESC' "$f/index.stdout" || { ok=0; why="$why no owner-scoped index;"; }
  # The repo's own tests, against the migrated disposable database.
  test_env $db
  ev_run $ac integration -- pnpm --filter @repo/api test:integration; local rt=$?
  unset EV_ENV_NAMES
  [ "$rt" = 0 ] || { ok=0; why="$why test:integration exit $rt;"; }
  grep -nE "rejects\(|projects_owner_order|owner_id, created_at DESC" "$WS/apps/api/test/migrations.test.mjs" > "$f/test-assertions.txt"
  local pair
  for pair in "23505|primary key" "23502|owner not null" "23502|name not null" "23514|owner length" "23514|name minimum length" "23514|name maximum length" "23514|name trimmed" "23514|version positive"; do
    grep -E "rejects\(.*'${pair%%|*}', '${pair##*|}'" "$f/test-assertions.txt" > /dev/null || { ok=0; why="$why no test asserting SQLSTATE ${pair%%|*} for ${pair##*|};"; }
  done
  grep -q 'owner_id, created_at DESC, id DESC' "$f/test-assertions.txt" || { ok=0; why="$why no test of the owner-scoped index;"; }
  cat "$f/integration.stdout" "$f/integration.stderr" > "$f/integration.all"
  grep -q 'database constraints reject rule-breaking writes' "$f/integration.all" || { ok=0; why="$why constraint test not in the output;"; }
  grep -Eq '(not ok|✖|(#|ℹ) fail [1-9])' "$f/integration.all" && { ok=0; why="$why failing tests in the output;"; }
  if [ $ok = 1 ]; then verdict $ac PASS "PK, NOT NULL (5 cols), owner/name length, name trim, version>=1 and projects_owner_order exist; migrations.test.mjs asserts SQLSTATE 23505/23502/23514 per rule; test:integration exit 0"; else verdict $ac FAIL "${why# }"; fi
}

# ---------- the running stack for AC-49 to AC-58 ----------
STACK_DB=acc_data_test
stack_up() {
  migrate_db "$SETUP" stack-migrate $STACK_DB || return 1
  unset EV_ENV_NAMES
  api_start api-1 127.0.0.1:15432 $STACK_DB || return 1
  web_start web-1 "http://127.0.0.1:14100" || return 1
}
ev_note "$SETUP" "stack: API on :$API_PORT (database through Toxiproxy :15432), web on :$WEB_PORT (API through Toxiproxy :14100), Keycloak issuer $KC_ISSUER"
if stack_up; then STACK_OK=1; else STACK_OK=0; fi
API_LOG="$EV/_runtime-$JOB/api-1.stdout"; DB_PROXY=pg
API_DIRECT="http://127.0.0.1:$API_PORT"

# ---------- AC-52 (first: alice owns exactly the 120 created here) ----------
ac52() {
  local ac=AC-52 f="$EV/AC-52" ok=1 why=""
  mkdir -p "$f"; kc_token_var TOKEN alice || { verdict $ac FAIL "no token"; return; }
  export API_URL="$API_DIRECT"; export EV_ENV_NAMES="TOKEN API_URL"
  ev_run $ac create-120 -- python3 "$DRO_DIR/ac52.py" create "$f"
  ev_run $ac page-all -- python3 "$DRO_DIR/ac52.py" page "$f"
  local sub; sub="$(dro_jwt_sub "$TOKEN")"
  dro_psql_ev $ac db-order $STACK_DB "SELECT id FROM projects WHERE owner_id='$sub' ORDER BY created_at DESC, id DESC"
  unset EV_ENV_NAMES
  local created uniq dbn
  created="$(grep -c . "$f/created-ids.txt")"; uniq="$(sort -u "$f/api-order.txt" | grep -c .)"; dbn="$(grep -c . "$f/db-order.stdout")"
  [ "$created" = 120 ] || { ok=0; why="$why only $created of 120 created;"; }
  [ "$(grep -c . "$f/api-order.txt")" = "$uniq" ] || { ok=0; why="$why duplicate ids across pages;"; }
  [ "$uniq" = 120 ] || { ok=0; why="$why paging returned $uniq unique ids, expected 120;"; }
  [ "$dbn" = 120 ] || { ok=0; why="$why database holds $dbn rows for the owner;"; }
  cmp -s "$f/api-order.txt" "$f/db-order.stdout" || { ok=0; why="$why API order differs from created_at DESC, id DESC in the database;"; }
  [ "$(sort "$f/created-ids.txt" | sort -u | comm -12 - <(sort "$f/api-order.txt") | grep -c .)" = 120 ] || { ok=0; why="$why a created id is missing from the pages;"; }
  python3 - "$f/limit-probes.json" > "$f/limit-verdict.txt" <<'PY' || { ok=0; why="$why above-maximum limit not rejected or capped;"; }
import json, sys
p = json.load(open(sys.argv[1]))
for q in ("limit=101", "limit=1000"):
    r = p[q]
    good = (r["status"] in (400, 422)) or (r["status"] == 200 and (r["items"] or 0) <= 100)
    print(q, r, "ok" if good else "BAD")
    if not good: sys.exit(1)
PY
  if [ $ok = 1 ]; then verdict $ac PASS "120 created; paging at limit 100 returns 120 unique ids, no gaps, equal to the database order (created_at DESC, id DESC); limit 101 and 1000 -> $(jq -r '."limit=101".status' "$f/limit-probes.json")/$(jq -r '."limit=1000".status' "$f/limit-probes.json")"; else verdict $ac FAIL "${why# }"; fi
}

# ---------- AC-49 ----------
ac49() {
  local ac=AC-49 f="$EV/AC-49" ok=1 why=""
  kc_token_var TOKEN alice || { verdict $ac FAIL "no token"; return; }
  export API_URL="$API_DIRECT"; export EV_ENV_NAMES="TOKEN API_URL"
  ev_run $ac fifty-parallel -- bash "$DRO_DIR/ac49.sh" "$f"
  unset EV_ENV_NAMES
  local p; p="$(cat "$f/project-id.txt")"
  dro_psql_ev $ac final-row $STACK_DB "SELECT name, version FROM projects WHERE id = '$p'"
  local n200 n409 winner
  n200="$(awk '$2==200' "$f/statuses.txt" | wc -l)"; n409="$(awk '$2==409' "$f/statuses.txt" | wc -l)"
  winner="$(awk '$2==200{print $1}' "$f/statuses.txt" | head -1)"
  [ "$n200" = 1 ] && [ "$n409" = 49 ] || { ok=0; why="$why histogram 200=$n200 409=$n409 (want 1 and 49);"; }
  local bad409=0 i
  for i in $(awk '$2==409{print $1}' "$f/statuses.txt"); do jq -e '.status==409' "$f/resp/$i.json" > /dev/null 2>&1 || bad409=$((bad409 + 1)); done
  [ "$bad409" = 0 ] || { ok=0; why="$why $bad409 conflicts were not problem-details with status 409;"; }
  local wname; wname="$(jq -r .name "$f/resp/$winner.json" 2>/dev/null)"
  [ "$(cat "$f/final-row.stdout")" = "$wname|2" ] || { ok=0; why="$why final row '$(cat "$f/final-row.stdout")' != '$wname|2';"; }
  if [ $ok = 1 ]; then verdict $ac PASS "50 parallel PATCH with the same expectedVersion: 1x200 and 49x409 problem-details; final row '$wname' version 2 equals the winner"; else verdict $ac FAIL "${why# }"; fi
}

# ---------- AC-51 ----------
ac51() {
  local ac=AC-51 f="$EV/AC-51" ok=1 why=""
  mkdir -p "$f/k6" "$f/latency"; chmod 777 "$f/k6"
  kc_token_var TOKEN alice || { verdict $ac FAIL "no token"; return; }
  export API_URL="$API_DIRECT"
  # Documented pool maximum.
  grep -n -i 'at most five connections' "$WS/apps/api/docs/architecture.md" > "$f/documented-pool-max.txt"
  grep -q -i 'at most five' "$f/documented-pool-max.txt" || { ok=0; why="$why pool maximum is not documented;"; }
  export PGC; bash "$DRO_DIR/pgsample.sh" "$f/pg-connections-load.txt" 75 $STACK_DB & local sampler=$!
  sleep 2
  export URL="$API_DIRECT/v1/projects?limit=25"; export EV_ENV_NAMES="TOKEN URL"
  ev_run $ac k6-load -- docker run --rm --cpus=2 --memory=2g --network host -v "$f/k6":/k6 -e URL -e TOKEN \
    "grafana/k6:1.3.0@sha256:3ddc8b1a33a2c3d8edc6e99b6a762ae36cba08788463458f5e6a7703e14eb77d" run --quiet --summary-export /k6/summary.json - < "$DRO_DIR/load.js"
  wait "$sampler"
  # k6 reads the script from stdin above only if given "-"; fall back to the mounted copy when that failed.
  if [ ! -s "$f/k6/summary.json" ]; then
    cp "$DRO_DIR/load.js" "$f/k6/load.js"
    ev_run $ac k6-load-file -- docker run --rm --cpus=2 --memory=2g --network host -v "$f/k6":/k6 -e URL -e TOKEN \
      "grafana/k6:1.3.0@sha256:3ddc8b1a33a2c3d8edc6e99b6a762ae36cba08788463458f5e6a7703e14eb77d" run --quiet --summary-export /k6/summary.json /k6/load.js
  fi
  # Database latency of 5 s with 50 concurrent requests.
  export EV_ENV_NAMES="TOKEN API_URL"
  ev_run $ac warm -- bash "$DRO_DIR/ac51-latency.sh" "$f/latency" warm
  bash "$DRO_DIR/pgsample.sh" "$f/pg-connections-latency.txt" 20 $STACK_DB & sampler=$!
  toxi_ev $ac toxic-add pg latency5s latency downstream '{"latency":5000,"jitter":0}'
  ev_run $ac burst-50 -- bash "$DRO_DIR/ac51-latency.sh" "$f/latency" burst
  toxi_untoxic_ev $ac toxic-remove pg latency5s
  wait "$sampler"
  unset EV_ENV_NAMES URL
  ev_run $ac analysis -- python3 "$DRO_DIR/ac51_check.py" "$f" 5 6 0
  local rc; rc="$(cat "$f/analysis.exit")"
  [ "$rc" = 0 ] || { ok=0; why="$why $(jq -r '.why | join("; ")' "$f/analysis.stdout" 2>/dev/null)"; }
  # The API recovers once the delay is gone.
  local after; after="$(curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $TOKEN" "$API_DIRECT/v1/projects?limit=1")"
  echo "after latency removed: $after" > "$f/recovery.txt"
  [ "$after" = 200 ] || { ok=0; why="$why API did not recover (status $after);"; }
  if [ $ok = 1 ]; then verdict $ac PASS "200 VUs x 60 s: max $(jq -r .load_max_all "$f/analysis.stdout") DB connections (pool max 5); 5 s DB latency: 50/50 -> $(jq -c .latency_status_histogram "$f/analysis.stdout"), slowest $(jq -r .latency_max_seconds "$f/analysis.stdout") s (literal deadline 6 s, no slack)"; else verdict $ac FAIL "${why# }"; fi
}

# ---------- AC-50 ----------
ac50() {
  local ac=AC-50 f="$EV/AC-50" ok=1 why=""
  node_scripts $ac
  ev_run $ac playwright -- node "$DRO_DIR/ac50.mjs"; local rc=$?
  [ "$rc" = 0 ] || { ok=0; why="$why scenario script exit $rc;"; }
  local n; n="$(jq 'length' "$f/results.json" 2>/dev/null || echo 0)"
  [ "$n" = 4 ] || { ok=0; why="$why $n of 4 attempts recorded;"; }
  local bad; bad="$(jq -r '[.[] | select(.delta != 1)] | map("\(.label) delta=\(.delta)") | join(", ")' "$f/results.json" 2>/dev/null)"
  [ -z "$bad" ] || { ok=0; why="$why records created != 1: $bad;"; }
  local d
  for d in apps/api/docs/features/projects.md apps/web/docs/features/projects.md; do
    grep -Eiq 'not idempotent' "$WS/$d" && grep -Eiq 'reload' "$WS/$d" && grep -Eiq 'timeout' "$WS/$d" || { ok=0; why="$why $d lacks the duplicate/retry policy;"; }
  done
  grep -n -i -E 'idempotent|reload' "$WS/apps/api/docs/features/projects.md" "$WS/apps/web/docs/features/projects.md" > "$f/docs-policy.txt"
  if [ $ok = 1 ]; then verdict $ac PASS "double-click and double-Enter each created exactly 1 project, also with 2 s latency web->API (browser POSTs: $(jq -c '[.[].browserPostsToWeb]' "$f/results.json")); both feature docs state POST is not idempotent and to reload after an ambiguous timeout"; else verdict $ac FAIL "${why# }"; fi
}

# ---------- AC-58 ----------
ac58() {
  local ac=AC-58 f="$EV/AC-58" ok=1 why=""
  node_scripts $ac
  ev_run $ac playwright -- node "$DRO_DIR/ac58.mjs"; local rc=$?
  [ "$rc" = 0 ] || { ok=0; why="$why scenario script exit $rc;"; }
  local n; n="$(jq 'length' "$f/results.json" 2>/dev/null || echo 0)"
  [ "$n" = 8 ] || { ok=0; why="$why $n of 8 scenarios recorded;"; }
  local bad; bad="$(jq -r '[.[] | select(.kind != "list") | select(.apiWriteCompletions != 1 or .browserActionPosts != 1)] | map("\(.label): browser POSTs=\(.browserActionPosts) API writes=\(.apiWriteCompletions)") | join("; ")' "$f/results.json" 2>/dev/null)"
  [ -z "$bad" ] || { ok=0; why="$why $bad;"; }
  local gets; gets="$(jq -r '[.[] | select(.kind == "list")][0].apiGetCompletions' "$f/results.json" 2>/dev/null)"
  if [ "${gets:-x}" = 1 ]; then :
  elif [ -n "$gets" ] && [ "$gets" -le 3 ] 2>/dev/null && grep -Eiq 'retr' "$WS/apps/web/docs/operations.md"; then :
  else ok=0; why="$why list page load made $gets API GETs;"; fi
  cp "$API_LOG" "$f/api-log-full.jsonl" 2>/dev/null
  if [ $ok = 1 ]; then verdict $ac PASS "7 faulted submits (latency 10 s, reset, timeout, API 503; rename and create): each = 1 browser POST = 1 API write completion; list load under 503 = $gets API GET"; else verdict $ac FAIL "${why# }"; fi
}

ac46; ac47; ac48
if [ "$STACK_OK" = 1 ]; then
  ac52; ac49; ac51; ac50; ac58
else
  dro_fail_all "the API/web stack did not start (evidence/_runtime-$JOB and evidence/$SETUP)" AC-49 AC-50 AC-51 AC-52 AC-58
fi
dro_stop web-1 15; dro_stop api-1 15
