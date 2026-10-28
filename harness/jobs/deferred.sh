#!/bin/bash
# AC-97 to AC-107: target evidence is DEFERRED. This job (1) scans generated documents for verification claims
# (protocol rule 5), (2) runs the local prerequisites that are not separate criteria (AC-100 test:replicas, AC-105 check
# names) and cheap presence checks for what each criterion names, and (3) records the prerequisite criteria that other
# jobs grade. harness/finalize-deferred.mjs turns a DEFERRED into FAIL if one of those is not PASS.
. "$(dirname "$0")/../lib/common.sh"
OPS="$HARNESS/infra/ops"
provenance || exit 1
secrets_init
mkdir -p "$EV/claim-scan"

dverdict() { # AC result reason prerequisites...
  local ac="$1" result="$2" reason="$3"; shift 3
  python3 - "$RES/$ac.json" "$ac" "$result" "$reason" "$JOB" "${TARGET_SHA:-}" "${TARGET_TREE:-}" "$@" <<'PY'
import json, sys
p, ac, result, reason, job, sha, tree, *pre = sys.argv[1:]
json.dump({"ac": ac, "result": result, "reason": reason, "job": job, "commit": sha, "skillTree": tree, "prerequisites": pre}, open(p, "w"), indent=2)
PY
  echo "$ac $result — $reason"
}
have() { grep -qE -- "$1" "$WS/$2" 2> /dev/null; }

# ---------- claim scan (rule 5) ----------
ev_run claim-scan scan -- python3 "$OPS/claim-scan.py" "$WS"; scan=$?

# ---------- local prerequisites that need a run ----------
ws_install; ws_build
infra_up postgres redis > "$EV/_infra-deferred.txt" 2>&1
test_env
playwright_install
ev_run AC-100 test-replicas -- pnpm --filter @repo/web test:replicas; rep=$?
unset EV_ENV_NAMES

# ---------- AC-105: documented check names equal the workflow's job names ----------
ev_run AC-105 workflow-jobs -- bash -c "grep -nE '^name:|^  [a-zA-Z0-9_-]+:\$|^    name:' .github/workflows/verify.yml; echo ---; grep -n 'status check\|required check' docs/operations.md"
job_ids="$(awk '/^jobs:/{f=1;next} f&&/^  [A-Za-z0-9_-]+:/{gsub(/[ :]/,"");print}' "$WS/.github/workflows/verify.yml")"
named=1; for j in $job_ids; do grep -q "\`$j\`" "$WS/docs/operations.md" || named=0; done
echo "job ids: $job_ids; all named in docs/operations.md: $named" > "$EV/AC-105/names.txt"

P="Prerequisite criteria are graded by their own jobs"
note() { echo "target evidence not verifiable here; claim scan clean=$([ $scan = 0 ] && echo yes || echo no)"; }
fail_scan() { [ $scan = 0 ] || return 1; }

# Each criterion: local checks, then verdict.
chk() { # AC "description" command...   -> records into $W_ok / $W_why
  local d="$2"; shift 2
  if "$@"; then :; else AC_OK=0; AC_WHY="$AC_WHY missing: $d;"; fi
}
finish() { # AC prerequisites...
  local ac="$1"; shift
  if [ "$AC_OK" = 1 ] && [ $scan = 0 ]; then dverdict "$ac" DEFERRED "target part DEFERRED (not verified). Local checks here passed, claim scan clean. $P: $*." "$@"
  else dverdict "$ac" FAIL "local check failed:${AC_WHY} claim scan exit=$scan. Target part DEFERRED." "$@"; fi
}
AC_OK=1; AC_WHY=""
chk AC-97 "Dockerfile runtime/migrate targets" bash -c "grep -q 'AS runtime' '$WS/apps/api/Dockerfile' && grep -q 'AS migrate' '$WS/apps/api/Dockerfile' && grep -q 'AS runtime' '$WS/apps/web/Dockerfile'"
chk AC-97 "release docs" have 'Release order' docs/operations.md
finish AC-97 AC-76 AC-77 AC-81 AC-86 AC-87
AC_OK=1; AC_WHY=""
chk AC-98 "OIDC implementation" test -f "$WS/apps/web/src/lib/identity.ts"
chk AC-98 "AUTH_CLIENT_SECRET marked secret" have 'AUTH_CLIENT_SECRET.*yes' apps/web/docs/environment.md
finish AC-98 AC-32 AC-33 AC-34 AC-35 AC-36 AC-37 AC-38
AC_OK=1; AC_WHY=""
chk AC-99 "TRUST_PROXY_CIDRS documented" have 'TRUST_PROXY_CIDRS' apps/api/docs/environment.md
finish AC-99 AC-34 AC-40 AC-42
AC_OK=1; AC_WHY=""
[ $rep = 0 ] || { AC_OK=0; AC_WHY=" pnpm --filter @repo/web test:replicas exit $rep (a local failure fails this criterion);"; }
finish AC-100 AC-42
AC_OK=1; AC_WHY=""
chk AC-101 "test:recovery script" have '"test:recovery"' apps/api/package.json
chk AC-101 "RPO/RTO placeholders" have 'Recovery point objective' docs/operations.md
finish AC-101 AC-88
AC_OK=1; AC_WHY=""
chk AC-102 "SLI table" have 'Service-level indicators' docs/operations.md
finish AC-102 AC-59 AC-61 AC-62
AC_OK=1; AC_WHY=""
chk AC-103 "test:load script" have '"test:load"' apps/api/package.json
chk AC-103 "pool budget across replicas" have 'budgeted across all replicas' apps/api/docs/production-profiles.md
finish AC-103 AC-51 AC-96
AC_OK=1; AC_WHY=""
chk AC-104 "sbom script" test -f "$WS/scripts/sbom.mjs"
finish AC-104 AC-80 AC-94
AC_OK=1; AC_WHY=""
chk AC-105 "docs name the workflow's check names" test "$named" = 1
finish AC-105 AC-83
AC_OK=1; AC_WHY=""
chk AC-106 "secrets marked in env docs" have '\| yes \|' apps/api/docs/environment.md
chk AC-106 "rotation table" have 'Secret rotation' docs/operations.md
finish AC-106 AC-22 AC-25 AC-89
AC_OK=1; AC_WHY=""
chk AC-107 "performance budget" test -f "$WS/apps/web/performance-budget.json"
chk AC-107 "check:budget script" have '"check:budget"' apps/web/package.json
finish AC-107 AC-23 AC-70
exit 0
