#!/bin/bash
# Testing depth: AC-72 (layers, fail closed), AC-73 (test DB protection), AC-75 (determinism).
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/quality.sh"
provenance || exit 1
secrets_init
fail_all() { local ac; for ac in AC-72 AC-73 AC-75; do verdict "$ac" FAIL "$1"; done; scrub_secrets; exit 0; }
setup_quality fail_all || exit 0

# ---------- AC-73: protected test databases ----------
ok=1; why=""
ev_run AC-73 createdb -- pg_createdb acme_prodlike || { ok=0; why="$why createdb failed;"; }
for env in test production; do
  for s in test:integration test:runtime test:e2e; do
    l="${s//:/_}-NODE_ENV-$env"
    ( test_env acme_prodlike; export NODE_ENV=$env; ev_run AC-73 "$l" -- pnpm "$s" ); code=$?
    [ "$code" != 0 ] || { ok=0; why="$why $s with NODE_ENV=$env exited 0;"; }
    grep -qiE '_test|NODE_ENV=test|disposable' "$(merged AC-73 "$l")" || { ok=0; why="$why $s NODE_ENV=$env gave no refusal message;"; }
  done
done
ev_run AC-73 dt -- pg_sql -d acme_prodlike -c '\dt'
ev_run AC-73 table-count -- pg_sql -d acme_prodlike -c "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')"
ev_run AC-73 inserts -- pg_sql -c "SELECT datname, tup_inserted, numbackends FROM pg_stat_database WHERE datname='acme_prodlike'"
[ "$(tr -d ' \n' < "$EV/AC-73/table-count.stdout")" = 0 ] || { ok=0; why="$why acme_prodlike has tables;"; }
if [ $ok = 1 ]; then verdict AC-73 PASS "integration, runtime and e2e all refuse acme_prodlike with NODE_ENV=test and NODE_ENV=production (non-zero, refusal message); database has zero tables"
else verdict AC-73 FAIL "${why# }"; fi

# ---------- AC-75: three consecutive runs, fresh databases, no retries ----------
ok=1; why=""
grep -nE 'retries' "$WS"/apps/web/playwright*.ts > "$EV/_setup-$JOB/retries-config.txt" 2>&1
if grep -qE 'retries: *[1-9]' "$EV/_setup-$JOB/retries-config.txt"; then ok=0; why="$why playwright retries configured;"; fi
for r in 1 2 3; do
  ev_run AC-75 "createdb-$r" -- pg_createdb "acme_run${r}_test" || { ok=0; why="$why run $r createdb failed;"; }
  ( test_env "acme_run${r}_test"; export TURBO_FORCE=true; EV_ENV_NAMES="$EV_ENV_NAMES TURBO_FORCE"
    ev_run AC-75 "run$r" -- bash -c 'pnpm test:unit && unset TURBO_FORCE && pnpm test:integration && pnpm test:runtime && pnpm test:e2e' ); code=$?
  f="$(merged AC-75 "run$r")"
  [ "$code" = 0 ] || { ok=0; why="$why run $r exit $code;"; }
  if skipped_in "$f"; then ok=0; why="$why run $r reported skipped/flaky tests;"; fi
  p="$(grep -oE '[0-9]+ passed' "$f" | tr '\n' ' ')"
  echo "run $r exit=$code passed-lines: $p" >> "$EV/AC-75/summary.txt"
done
if [ $ok = 1 ]; then verdict AC-75 PASS "3/3 consecutive runs of unit+integration+runtime+e2e (unit forced, fresh DBs) exit 0; no skipped, flaky or retried tests; $(tr '\n' ';' < "$EV/AC-75/summary.txt")"
else verdict AC-75 FAIL "${why# }"; fi

# ---------- AC-72: layers, CI steps, fail-closed ----------
ok=1; why=""
ev_run AC-72 root-scripts -- jq -r '.scripts | to_entries[] | select(.key|test("^(test|contract)")) | "\(.key)\t\(.value)"' package.json
ev_run AC-72 ci-run-steps -- bash -c "grep -hE '^[[:space:]]*(- )?run:' .github/workflows/*.yml"
ev_run AC-72 suite-files -- bash -c "ls apps/api/test/*.unit.test.mjs apps/web/scripts/*.test.mjs apps/api/test/contracts.test.mjs apps/api/test/api.test.mjs apps/api/test/migrations.test.mjs apps/api/test/runtime.test.mjs apps/web/scripts/runtime.test.mjs apps/web/tests/*.spec.ts"
for c in 'pnpm test:unit' 'pnpm contract:check' 'pnpm test:integration' 'pnpm test:runtime' 'pnpm test:e2e'; do
  grep -qF "run: $c" "$EV/AC-72/ci-run-steps.stdout" || { ok=0; why="$why CI does not run '$c';"; }
done
[ "$(cat "$EV/AC-72/suite-files.exit")" = 0 ] || { ok=0; why="$why a suite file is missing;"; }
# Baseline with everything available.
for s in test:integration test:runtime test:e2e; do
  l="up-${s//:/_}"; db="q72_up_${s//:/_}_test"
  ev_run AC-72 "createdb-$l" -- pg_createdb "$db"
  suite AC-72 "$l" "$db" "$s" || { ok=0; why="$why baseline $s failed;"; }
  skipped_in "$(merged AC-72 "$l")" && { ok=0; why="$why baseline $s skipped tests;"; }
done
# expect_fail LABEL REGEX DB SCRIPT [VAR=value...]
expect_fail() {
  local l="$1" re="$2"; shift 2
  suite AC-72 "$l" "$@"; local code=$?
  [ "$code" != 0 ] || { ok=0; why="$why $l exited 0;"; return; }
  grep -qiE "$re" "$(merged AC-72 "$l")" || { ok=0; why="$why $l: no message matching $re;"; }
  skipped_in "$EV/AC-72/$l.out" && { ok=0; why="$why $l reported skipped tests;"; }
}
# DATABASE_URL unset: test_env sets it, so unset it again inside the run.
nodb() { ( test_env x; unset DATABASE_URL; ev_run AC-72 "$1" -- pnpm "$2" ); }
for s in test:integration test:runtime test:e2e; do
  l="nourl-${s//:/_}"; nodb "$l" "$s"; code=$?
  [ "$code" != 0 ] || { ok=0; why="$why $l exited 0;"; }
  grep -qE 'DATABASE_URL' "$(merged AC-72 "$l")" || { ok=0; why="$why $l: message does not name DATABASE_URL;"; }
done
# Chromium unavailable (empty browsers folder).
mkdir -p "$WORK/empty-browsers"
for s in test:integration test:e2e; do
  l="nobrowser-${s//:/_}"; db="q72_nb_${s//:/_}_test"
  ev_run AC-72 "createdb-$l" -- pg_createdb "$db"
  expect_fail "$l" "Executable doesn't exist|playwright install" "$db" "$s" "PLAYWRIGHT_BROWSERS_PATH=$WORK/empty-browsers"
done
# Postgres stopped.
ev_run AC-72 postgres-stop -- docker compose -f "$HARNESS/infra/compose.yaml" stop postgres
for s in test:integration test:runtime test:e2e; do
  l="down-${s//:/_}"
  expect_fail "$l" "ECONNREFUSED|Cannot connect|connection refused" acme_test "$s"
done
if [ $ok = 1 ]; then verdict AC-72 PASS "unit, contract, integration, runtime and e2e exist and run in CI; integration/runtime/e2e exit non-zero naming DATABASE_URL, the unreachable database, or the missing browser; no skipped tests"
else verdict AC-72 FAIL "${why# }"; fi
scrub_secrets
