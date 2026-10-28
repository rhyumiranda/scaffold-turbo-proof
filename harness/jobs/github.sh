#!/bin/bash
# Parts of the GitHub criteria that run on a clone: AC-24 (local check, gitleaks on main history),
# AC-28 (local drift and regeneration), AC-85 (workflow hardening, complete), AC-93 (config coverage).
# The pull-request parts of AC-24, AC-28 and AC-84, plus AC-83 and GitHub's view of AC-93, need pushes that
# start workflows, which GITHUB_TOKEN cannot do; harness/github/prs.sh runs them and combines the parts.
. "$(dirname "$0")/../lib/common.sh"
provenance || exit 1
secrets_init
mkdir -p "$RES/parts"
part() { python3 -c 'import json,sys; json.dump({"ac":sys.argv[1],"result":sys.argv[2],"reason":sys.argv[3]},open(sys.argv[4],"w"),indent=2)' "$1" "$2" "$3" "$RES/parts/$1.json"; echo "$1 part $2 — $3"; }
DIFFS="$HARNESS/github/defects"
ACTIONLINT="rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667"
ZIZMOR="ghcr.io/zizmorcore/zizmor:1.31.1@sha256:42d409dbb851d4c5d35a058cf042b828bea1e3f2884378c526eb0974780e18d9"

ws_install

# ---------- AC-24 local part ----------
# Only the history reachable from the published main commit; other branches of this repo hold test defects.
ev_run AC-24 gitleaks-main-history -- docker run --rm --cpus=2 --memory=2g -v "$WS":/r "$GITLEAKS" detect --source /r --redact --no-banner -v --log-opts="$TARGET_SHA"
gl_main=$(cat "$EV/AC-24/gitleaks-main-history.exit")
git -C "$WS" switch -q -c throwaway/ac24
git -C "$WS" apply "$DIFFS/secrets.diff" && git -C "$WS" add -A && git -C "$WS" -c user.name=harness -c user.email=harness@invalid commit -qm "test: AC-24 throwaway secrets"
git -C "$WS" show --stat HEAD > "$EV/AC-24/throwaway.stat"
ev_run AC-24 check-secrets-throwaway -- pnpm check:secrets; cs=$?
named=1
for f in apps/api/src/x.ts apps/web/src/x.ts; do grep -q "$f" "$EV/AC-24/check-secrets-throwaway.stdout" "$EV/AC-24/check-secrets-throwaway.stderr" || named=0; done
git -C "$WS" switch -q --detach "$TARGET_SHA" && git -C "$WS" branch -q -D throwaway/ac24
if [ "$cs" != 0 ] && [ $named = 1 ] && [ "$gl_main" = 0 ]; then
  part AC-24 PASS "local check:secrets exit $cs naming both x.ts files; gitleaks on main history exit 0"
else
  part AC-24 FAIL "check:secrets exit $cs namesBothFiles=$named; gitleaks main history exit $gl_main"
fi

# ---------- AC-28 local part ----------
git -C "$WS" switch -q -c throwaway/ac28
git -C "$WS" apply "$DIFFS/contract-drift.diff" && git -C "$WS" add -A && git -C "$WS" -c user.name=harness -c user.email=harness@invalid commit -qm "test: AC-28 throwaway drift"
git -C "$WS" show HEAD > "$EV/AC-28/throwaway.diff"
ev_run AC-28 build -- pnpm build; b28=$?
ev_run AC-28 contract-check-drifted -- pnpm contract:check; c1=$?
drift_named=0; grep -Eq 'openapi\.json|api\.d\.ts|contract' "$EV/AC-28/contract-check-drifted.stdout" "$EV/AC-28/contract-check-drifted.stderr" && drift_named=1
ev_run AC-28 contract-generate -- pnpm contract:generate; g28=$?
ev_run AC-28 status-after-generate -- git status --porcelain
changed="$(awk '{print $2}' "$EV/AC-28/status-after-generate.stdout" | LC_ALL=C sort | tr '\n' ' ')"
ev_run AC-28 contract-check-after -- pnpm contract:check; c2=$?
git -C "$WS" checkout -q -- . && git -C "$WS" clean -qfd -e node_modules && git -C "$WS" switch -q --detach "$TARGET_SHA" && git -C "$WS" branch -q -D throwaway/ac28
expected="apps/api/openapi.json packages/api-client/contract/openapi.json packages/api-client/src/api.d.ts "
if [ "$b28" = 0 ] && [ "$c1" != 0 ] && [ $drift_named = 1 ] && [ "$g28" = 0 ] && [ "$changed" = "$expected" ] && [ "$c2" = 0 ]; then
  part AC-28 PASS "drifted contract:check exit $c1 naming the contract file; contract:generate changed exactly the three artifacts; recheck exit 0"
else
  part AC-28 FAIL "build=$b28 driftedCheck=$c1 named=$drift_named generate=$g28 changed=[$changed] recheck=$c2"
fi

# ---------- AC-85: workflow hardening (complete verdict) ----------
ev_run AC-85 actionlint -- docker run --rm --cpus=2 --memory=2g -v "$WS":/r -w /r "$ACTIONLINT" -color
ev_run AC-85 zizmor -- docker run --rm --cpus=2 --memory=2g -v "$WS":/r "$ZIZMOR" --format plain /r/.github/workflows
ev_run AC-85 zizmor-json -- docker run --rm --cpus=2 --memory=2g -v "$WS":/r "$ZIZMOR" --format json /r/.github/workflows
# Strictest persona too: it reports findings the default persona suppresses.
ev_run AC-85 zizmor-pedantic -- docker run --rm --cpus=2 --memory=2g -v "$WS":/r "$ZIZMOR" --persona pedantic --format json /r/.github/workflows
ev_run AC-85 uses -- bash -c "grep -n 'uses:' .github/workflows/*.yml"
ev_run AC-85 hardening-lines -- bash -c "grep -nE '^permissions:|^  contents:|persist-credentials|timeout-minutes|pull_request_target|secrets\\.' .github/workflows/*.yml"
al=$(cat "$EV/AC-85/actionlint.exit")
high=$(jq '[.[] | select((.determinations.severity // .severity // "") | test("^high$";"i"))] | length' "$EV/AC-85/zizmor-json.stdout" 2>/dev/null || echo parse-error)
high_pedantic=$(jq '[.[] | select((.determinations.severity // .severity // "") | test("^high$";"i"))] | length' "$EV/AC-85/zizmor-pedantic.stdout" 2>/dev/null || echo parse-error)
unpinned="$(grep -vE 'uses: [^@]+@[0-9a-f]{40}( |$)' "$EV/AC-85/uses.stdout" | tr '\n' ' ')"
wf=.github/workflows/verify.yml
top_perm=0; awk '/^permissions:/{p=1;next} p&&/^  contents: read/{f=1} /^[a-z]/{p=0} END{exit !f}' "$WS/$wf" && top_perm=1
# cat first: grep -c on a single file prints no file prefix.
checkouts=$(cat "$WS"/.github/workflows/*.yml | grep -c 'actions/checkout@')
nopersist=$(cat "$WS"/.github/workflows/*.yml | grep -c 'persist-credentials: false')
jobs_n=$(python3 -c 'import yaml,sys,glob; print(sum(len(yaml.safe_load(open(f))["jobs"]) for f in glob.glob(sys.argv[1]+"/.github/workflows/*.yml")))' "$WS")
timeouts=$(python3 -c 'import yaml,sys,glob; print(sum(1 for f in glob.glob(sys.argv[1]+"/.github/workflows/*.yml") for j in yaml.safe_load(open(f))["jobs"].values() if "timeout-minutes" in j))' "$WS")
prt=$(cat "$WS"/.github/workflows/*.yml | grep -c pull_request_target)
secrets_used=$(cat "$WS"/.github/workflows/*.yml | grep -cE '\$\{\{ *secrets\.')
if [ "$al" = 0 ] && [ "$high" = 0 ] && [ "$high_pedantic" = 0 ] && [ -z "$unpinned" ] && [ $top_perm = 1 ] && [ "$checkouts" = "$nopersist" ] && [ "$jobs_n" = "$timeouts" ] && [ "$prt" = 0 ] && [ "$secrets_used" = 0 ]; then
  verdict AC-85 PASS "actionlint exit 0; zizmor 0 High (default and pedantic personas); all uses: pinned to 40-hex SHA; top-level contents: read; $nopersist/$checkouts checkouts persist-credentials false; $timeouts/$jobs_n jobs have timeouts; no pull_request_target; no secrets referenced"
else
  verdict AC-85 FAIL "actionlint=$al zizmorHigh=$high pedanticHigh=$high_pedantic unpinned=[$unpinned] topPerm=$top_perm noPersist=$nopersist/$checkouts timeouts=$timeouts/$jobs_n prt=$prt secretsRefs=$secrets_used"
fi

# ---------- AC-93 config part ----------
ev_run AC-93 config -- cat .github/dependabot.yml
eco="$(python3 -c 'import yaml,sys; c=yaml.safe_load(open(sys.argv[1])); print(" ".join(sorted("%s:%s" % (u["package-ecosystem"], ",".join(sorted(u.get("directories") or [u.get("directory")]))) for u in c["updates"])))' "$WS/.github/dependabot.yml")"
echo "$eco" > "$EV/AC-93/ecosystems.txt"
has_npm=0; echo "$eco" | grep -Eq '(npm|pnpm):[^ ]*/( |,|$)' && has_npm=1
has_gha=0; echo "$eco" | grep -q 'github-actions:' && has_gha=1
has_docker=0; echo "$eco" | grep -Eq 'docker:[^ ]*/apps/api' && echo "$eco" | grep -Eq 'docker:[^ ]*/apps/web' && has_docker=1
if [ $has_npm = 1 ] && [ $has_gha = 1 ] && [ $has_docker = 1 ]; then part AC-93 PASS "config covers pnpm workspace root, GitHub Actions and both Dockerfiles: $eco"; else part AC-93 FAIL "npm=$has_npm actions=$has_gha docker(api+web)=$has_docker: $eco"; fi
