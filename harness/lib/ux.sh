# shellcheck shell=bash
# Helpers for the UX job (AC-63 to AC-71): production API and web processes against the real Keycloak realm, Toxiproxy
# between web and API, Playwright scripts that record named checks. Source after common.sh.
export WORK WS EV
UXI="$HARNESS/infra/ux"
UXR="$WORK/ux"
mkdir -p "$UXR"
# Toxiproxy 2.12.0, pinned by digest.
TOXIPROXY_IMAGE="ghcr.io/shopify/toxiproxy@sha256:9378ed52a28bc50edc1350f936f518f31fa95f0d15917d6eb40b8e376d1a214e"
LIGHTHOUSE_VERSION="13.5.0"

# Read-only or disposable-database helpers against the compose Postgres.
pg_sql() { docker compose -f "$HARNESS/infra/compose.yaml" exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
pg_createdb() { pg_sql -c "CREATE DATABASE \"$1\""; }

# Environment the Playwright scripts read. Names only are recorded in evidence.
ux_env() {
  export UX_BASE=http://localhost:3101 UX_BASE_SHORT=http://localhost:3102 UX_API=http://127.0.0.1:4101 UX_TOXI=http://127.0.0.1:8474 UX_KC=http://localhost:8080
  export UX_CTL="$UXI/ctl.sh"
  export ALICE_PASSWORD="$KC_USER_PASSWORD" BOB_PASSWORD="$KC_USER_PASSWORD" ACME_CLI_SECRET="$KC_ACME_CLI_SECRET"
  export EV_ENV_NAMES="WS WORK EV UX_BASE UX_BASE_SHORT UX_API UX_TOXI UX_KC UX_CTL ALICE_PASSWORD BOB_PASSWORD ACME_CLI_SECRET"
}

# Toxiproxy, the disposable UI database (migrated), the production API, and two production web instances
# (3101: normal sessions; 3102: sessions last 60 s, used only for the expiry checks).
ux_stack_up() {
  ux_env
  ev_run _setup-ux toxiproxy-run -- docker run -d --name ux-toxiproxy --network host --cpus=2 --memory=2g "$TOXIPROXY_IMAGE" || return 1
  local i
  for i in $(seq 1 60); do curl -sf http://127.0.0.1:8474/version > /dev/null && break; sleep 0.5; done
  ev_run _setup-ux toxiproxy-proxy -- curl -sf -X POST http://127.0.0.1:8474/proxies -d '{"name":"web_api","listen":"127.0.0.1:50410","upstream":"127.0.0.1:4101","enabled":true}' || return 1
  ev_run _setup-ux createdb -- pg_createdb ux_ui_test || return 1
  export DATABASE_URL="postgresql://postgres:$PG_PASSWORD@127.0.0.1:5432/ux_ui_test" NODE_ENV=test
  EV_ENV_NAMES="DATABASE_URL NODE_ENV" ev_run _setup-ux migrate "$WS/apps/api" -- node scripts/migrate.mjs || return 1
  unset DATABASE_URL NODE_ENV
  ev_run _setup-ux api-start -- bash "$UX_CTL" api start || return 1
  ev_run _setup-ux web-start -- bash "$UX_CTL" web start || return 1
  ev_run _setup-ux webshort-start -- bash "$UX_CTL" webshort start || return 1
}

ux_stack_down() {
  for p in webshort web api; do bash "$UXI/ctl.sh" "$p" stop > /dev/null 2>&1 || true; done
  docker rm -f ux-toxiproxy > /dev/null 2>&1 || true
  mkdir -p "$EV/_ux-logs"
  cp "$UXR"/*.log "$EV/_ux-logs/" 2>/dev/null || true
}

# pw AC label script [args...]   Runs one Playwright script under a time limit; exit 0 means every recorded check passed.
pw() {
  local ac="$1" label="$2" script="$3"; shift 3
  ev_run "$ac" "$label" -- timeout 1500 node "$UXI/pw/$script" "$@"
}
# pw_failed AC checks-file-name   Names of failed checks (or why the file is missing).
pw_failed() {
  local f="$EV/$1/$2.checks.json"
  [ -s "$f" ] || { echo "$2: no checks file"; return; }
  jq -r --arg n "$2" '"\($n): " + ((.failed | join("; ")) | .[0:400])' "$f"
}
pw_count() { jq -r '.checks | length' "$EV/$1/$2.checks.json" 2>/dev/null || echo 0; }

# Playwright counts from a captured run (the line looks like "  17 passed (25.6s)"; turbo may prefix it).
pw_total() { # file word -> number (0 when absent)
  local n; n="$(grep -oE "[0-9]+ $2\\b" "$1" 2>/dev/null | head -1 | grep -oE '^[0-9]+')"; echo "${n:-0}"
}

# Replace every generated secret value in the evidence and results folders.
scrub_secrets() {
  local v
  while IFS='=' read -r _ v; do
    [ -n "$v" ] || continue
    grep -rIlF -- "$v" "$EV" "$RES" 2>/dev/null | while read -r f; do sed -i "s/$v/***SECRET***/g" "$f"; done
  done < "$WORK/.secrets"
  return 0
}
