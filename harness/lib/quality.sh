# shellcheck shell=bash
# Helpers for the quality jobs (AC-72 to AC-75). Source after common.sh.
export WORK WS EV
pg_sql() { docker compose -f "$HARNESS/infra/compose.yaml" exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
pg_createdb() { pg_sql -c "CREATE DATABASE \"$1\""; }
# suite AC label DB pnpm-script [VAR=value...]  Runs a root suite against database DB in a clean env; returns the suite exit code.
suite() {
  local ac="$1" label="$2" db="$3" script="$4"; shift 4
  ( test_env "$db"; for kv in "$@"; do export "${kv?}"; done; ev_run "$ac" "$label" -- pnpm "$script" )
}
# Merge stdout and stderr of a labelled run into one .out file and print its path.
merged() { cat "$EV/$1/$2.stdout" "$EV/$1/$2.stderr" > "$EV/$1/$2.out" 2>/dev/null; echo "$EV/$1/$2.out"; }
count_word() { local n; n="$(grep -oE "[0-9]+ $2\\b" "$1" 2>/dev/null | head -1 | grep -oE '^[0-9]+')"; echo "${n:-0}"; }
# skipped_in FILE: succeeds when the output reports skipped, todo, flaky or retried tests.
skipped_in() { grep -qE '(^|[^0-9])([1-9][0-9]* (skipped|flaky|did not run)|(ℹ|#) (skipped|todo) [1-9])' "$1"; }
scrub_secrets() {
  local v
  while IFS='=' read -r _ v; do
    [ -n "$v" ] || continue
    grep -rIlF -- "$v" "$EV" "$RES" 2>/dev/null | while read -r f; do sed -i "s/$v/***SECRET***/g" "$f"; done
  done < "$WORK/.secrets"
  return 0
}
setup_quality() { # fail_all callback name
  ws_install || { "$1" "setup failed: pnpm install"; return 1; }
  ws_build || { "$1" "setup failed: pnpm build"; return 1; }
  infra_up postgres redis || { "$1" "setup failed: Postgres/Redis"; return 1; }
  playwright_install || { "$1" "setup failed: Playwright Chromium"; return 1; }
}
