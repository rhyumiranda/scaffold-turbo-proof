# Shared helpers for acceptance jobs. Source this file; it sets WORK, WS, EV, RES and helper functions.
set -uo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${WORK:-$GITHUB_WORKSPACE/acc run}"          # the space is deliberate (criteria section 0.1)
WS="$WORK/ws"                                       # fresh HTTPS clone of the generated commit
EV="$WORK/evidence"                                 # raw evidence, one folder per criterion
RES="$WORK/results"                                 # one JSON verdict per criterion
JOB="${JOB:-unknown}"
mkdir -p "$EV" "$RES"
export TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1
# Pinned scanner images (tag and digest).
GITLEAKS="zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"

# Random per-run secrets, masked in the log and kept in a mode-600 file; values never enter evidence.
secrets_init() {
  umask 077
  : > "$WORK/.secrets"
  for name in PG_PASSWORD KC_ADMIN_PASSWORD KC_USER_PASSWORD KC_ACME_WEB_SECRET KC_ACME_CLI_SECRET KC_ACME_NOAUD_SECRET KC_OTHER_CLI_SECRET; do
    value="$(openssl rand -hex 18)"
    echo "::add-mask::$value"
    printf '%s=%s\n' "$name" "$value" >> "$WORK/.secrets"
    export "$name=$value"
  done
  # The web app's sign-in transaction key: base64url of 32 random bytes, the same for every web process in one job.
  value="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
  echo "::add-mask::$value"
  printf '%s=%s\n' AUTH_TRANSACTION_SECRET "$value" >> "$WORK/.secrets"
  export AUTH_TRANSACTION_SECRET="$value"
  umask 022
}

# infra_up [service...]   Starts the test services (all when none named) and waits until healthy.
infra_up() {
  ( cd "$HARNESS/infra" && docker compose up -d --wait --wait-timeout 240 "$@" ) || { docker compose -f "$HARNESS/infra/compose.yaml" logs --tail 80; return 1; }
}

# The same disposable test environment the generated CI uses (DB name ends in _test; identity hosts never resolve).
test_env() {
  export NODE_ENV=test
  export DATABASE_URL="postgresql://postgres:$PG_PASSWORD@127.0.0.1:5432/${1:-acme_test}"
  export TEST_REDIS_URL=redis://127.0.0.1:6379
  export AUTH_ISSUER=https://identity.example.invalid/ AUTH_AUDIENCE=reference AUTH_JWKS_URL=https://identity.example.invalid/jwks
  export API_BASE_URL=https://api.example.invalid
  export EV_ENV_NAMES="NODE_ENV DATABASE_URL TEST_REDIS_URL AUTH_ISSUER AUTH_AUDIENCE AUTH_JWKS_URL API_BASE_URL AUTH_TRANSACTION_SECRET"
}

playwright_install() { ev_run "_setup-$JOB" playwright -- pnpm --filter @repo/web exec playwright install --with-deps chromium; }

# tracked_clean AC-NN label   Saves `git status` of tracked files; returns non-zero when any tracked file changed.
tracked_clean() {
  ev_run "$1" "$2" -- git status --porcelain=v1 --untracked-files=no
  [ ! -s "$EV/$1/$2.stdout" ]
}

# ev_run AC-NN label [cwd] -- command...   Records command, working dir, env names, stdout, stderr, exit and times.
ev_run() {
  local ac="$1" label="$2"; shift 2
  local dir="$WS"; if [ "$1" != "--" ]; then dir="$1"; shift; fi; shift
  local d="$EV/$ac"; mkdir -p "$d"
  local start end code
  start="$(date -u +%FT%TZ)"
  ( cd "$dir" && "$@" ) > "$d/$label.stdout" 2> "$d/$label.stderr"; code=$?
  end="$(date -u +%FT%TZ)"
  {
    echo "### $label"
    echo '```'; printf '%q ' "$@"; echo; echo '```'
    echo "- cwd: ${dir#$WORK/}"
    echo "- env names: ${EV_ENV_NAMES:-none}"
    echo "- exit: $code"
    echo "- start: $start  end: $end"
    echo "- stdout: $label.stdout  stderr: $label.stderr"
    echo
  } >> "$d/commands.md"
  echo "$code" > "$d/$label.exit"
  return $code
}

# verdict AC-NN PASS|FAIL "one-line reason"
verdict() {
  local ac="$1" result="$2" reason="$3"
  python3 - "$RES/$ac.json" "$ac" "$result" "$reason" "$JOB" "${TARGET_SHA:-}" "${TARGET_TREE:-}" <<'PY'
import json,sys
p,ac,result,reason,job,sha,tree=sys.argv[1:]
json.dump({"ac":ac,"result":result,"reason":reason,"job":job,"commit":sha,"skillTree":tree},open(p,"w"),indent=2)
PY
  echo "$ac $result — $reason"
}

# Record provenance: the fresh clone, its origin and commit, toolchain and skill hashes.
provenance() {
  local d="$EV/_provenance-$JOB"; mkdir -p "$d"
  {
    echo "origin: $(git -C "$WS" remote get-url origin)"
    echo "commit: $(git -C "$WS" rev-parse HEAD)"
    echo "expected commit: ${TARGET_SHA:-}"
    echo "tracked changes: $(git -C "$WS" status --porcelain --untracked-files=no | wc -l)"
    echo "node: $(node -v)  pnpm: $(pnpm -v)  docker: $(docker version --format '{{.Server.Version}}')"
    echo "skill tree (snapshot): $(cd "$HARNESS/skills" && find scaffold-nest scaffold-next scaffold-turbo-nest-next -type f ! -name .DS_Store | LC_ALL=C sort | tr '\n' '\0' | xargs -0 sha256sum | sha256sum | cut -c1-64)"
    echo "expected skill tree: ${TARGET_TREE:-}"
    (cd "$HARNESS/skills" && sha256sum scaffold-turbo-nest-next/SKILL.md scaffold-turbo-nest-next/scripts/scaffold.mjs scaffold-nest/scripts/scaffold.mjs scaffold-next/scripts/scaffold.mjs)
  } > "$d/provenance.txt"
  [ "$(git -C "$WS" rev-parse HEAD)" = "$TARGET_SHA" ] || { echo "Clone is not at the target commit"; return 1; }
}

ws_install() { ev_run "_setup-$JOB" install -- nice -n 5 pnpm install --frozen-lockfile; }
ws_build() { ev_run "_setup-$JOB" build -- pnpm build; }
