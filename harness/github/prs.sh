#!/bin/bash
# Pull-request and GitHub-side checks that a workflow token cannot trigger: AC-83 (main CI run), AC-84 (ten
# defect PRs), the PR parts of AC-24 and AC-28, and GitHub's acceptance of the Dependabot config (AC-93).
# Runs from the owner's machine: light work only (git, gh). Combines with the CI job "github" parts.
# usage: prs.sh <out-dir> <ci-run-id-with-github-job>
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$1"; CI_RUN="$2"
REPO=rhyumiranda/scaffold-turbo-proof
TARGET_SHA="$(jq -r .commit "$HERE/../TARGET.json")"
TARGET_TREE="$(jq -r .skillTree "$HERE/../TARGET.json")"
EV="$OUT/evidence"; RES="$OUT/results"; mkdir -p "$EV" "$RES"
JOB=github-prs
CLONE="$OUT/clone"
TAG="rhyu/h1-$(date -u +%m%d%H%M)"

log() { printf '%s %s\n' "$(date -u +%T)" "$*" | tee -a "$EV/prs.log" >&2; }
rec() { local ac="$1" label="$2"; shift 2; mkdir -p "$EV/$ac"; { echo "### $label"; echo '```'; printf '%q ' "$@"; echo; echo '```'; } >> "$EV/$ac/commands.md"; "$@" > "$EV/$ac/$label.stdout" 2> "$EV/$ac/$label.stderr"; local c=$?; echo "- exit: $c  at $(date -u +%FT%TZ)" >> "$EV/$ac/commands.md"; echo $c > "$EV/$ac/$label.exit"; return $c; }
verdict() {
  python3 -c 'import json,sys; json.dump(dict(zip(["ac","result","reason","job","commit","skillTree"],sys.argv[2:])),open(sys.argv[1],"w"),indent=2)' "$RES/$1.json" "$1" "$2" "$3" "$JOB" "$TARGET_SHA" "$TARGET_TREE"
  log "$1 $2 — $3"
}

# Fresh HTTPS clone of the published commit.
rm -rf "$CLONE"
rec _provenance clone git clone -q https://github.com/$REPO.git "$CLONE" || exit 1
git -C "$CLONE" checkout -q "$TARGET_SHA" || exit 1
git -C "$CLONE" config user.name "Rhyu Miranda"; git -C "$CLONE" config user.email rhyu.agapito.miranda@gmail.com
{ echo "origin: $(git -C "$CLONE" remote get-url origin)"; echo "commit: $(git -C "$CLONE" rev-parse HEAD)"; echo "expected: $TARGET_SHA"; echo "gh: $(gh --version | head -1)"; } > "$EV/_provenance/provenance.txt"

# wait_run <event> <sha> <file-prefix>   Waits for the "Verify workspace" run of that commit, saves its jobs/steps.
wait_run() {
  local event="$1" sha="$2" pre="$3" id=""
  for _ in $(seq 1 90); do
    id="$(gh run list --repo $REPO --workflow "Verify workspace" --commit "$sha" --event "$event" --json databaseId --jq '.[0].databaseId // empty')"
    [ -n "$id" ] && break; sleep 10
  done
  [ -n "$id" ] || { echo "no $event run for $sha"; return 1; }
  gh run watch "$id" --repo $REPO --interval 30 > /dev/null 2>&1
  gh run view "$id" --repo $REPO --json databaseId,event,headSha,status,conclusion,createdAt,updatedAt,startedAt,url,jobs > "$pre-run-$id.json"
  jq -r '.jobs[].steps[] | "\(.number)\t\(.conclusion)\t\(.name)"' "$pre-run-$id.json" > "$pre-run-$id-steps.tsv"
  gh run view "$id" --repo $REPO --log-failed > "$pre-run-$id-failed.log" 2>&1 || true
  echo "$id"
}

# ---------- AC-84 (and the PR parts of AC-24 and AC-28): one PR per defect ----------
# defect | diff file | first failing step must match
DEFECTS="lint|lint.diff|^Run pnpm lint\$
type|type.diff|^Run pnpm typecheck\$
unit|unit.diff|^Run pnpm test:unit\$
contract|contract-drift.diff|contract
secret|secrets.diff|^Run pnpm check:secrets\$
cross-app|cross-app.diff|^Run pnpm (boundaries|check:arch|lint)\$
lockfile|lockfile.diff|^Run pnpm install --frozen-lockfile\$
advisory|advisory.diff|^Run pnpm audit --audit-level=high\$
format|format.diff|^Run pnpm format:check\$
dockerfile|dockerfile.diff|test:container"
mkdir -p "$EV/AC-84"
PRS="$OUT/prs"; mkdir -p "$PRS"   # one file per defect: <name>.sha and <name>.num (bash 3 has no maps)
while IFS='|' read -r name diff _; do
  b="$TAG/$name"
  git -C "$CLONE" checkout -q -B "$b" "$TARGET_SHA"
  git -C "$CLONE" apply "$HERE/defects/$diff" || { log "apply failed $name"; continue; }
  git -C "$CLONE" add -A && git -C "$CLONE" commit -qm "test(acceptance): inject $name defect"
  git -C "$CLONE" log -1 --format='Author: %an <%ae>%nCommitter: %cn <%ce>' > "$EV/AC-84/identity-$name.txt"
  grep -q 'Author: Rhyu Miranda <rhyu.agapito.miranda@gmail.com>' "$EV/AC-84/identity-$name.txt" && grep -q 'Committer: Rhyu Miranda <rhyu.agapito.miranda@gmail.com>' "$EV/AC-84/identity-$name.txt" || { log "identity wrong"; exit 1; }
  git -C "$CLONE" show HEAD > "$EV/AC-84/branch-$name.diff"
  git -C "$CLONE" push -q -f origin "$b" 2> "$EV/AC-84/push-$name.stderr"
  git -C "$CLONE" rev-parse HEAD > "$PRS/$name.sha"
  gh pr create --repo $REPO --base main --head "$b" --draft --title "test(acceptance): $name defect (AC-84)" --body "Throwaway acceptance test: one injected $name defect. CI must fail at the matching step. Closed after the run." 2>> "$EV/AC-84/pr-$name.stderr" | grep -oE '[0-9]+$' > "$PRS/$name.num"
  echo "$name pr=$(cat "$PRS/$name.num") sha=$(cat "$PRS/$name.sha") branch=$b" >> "$EV/AC-84/prs.txt"
  log "opened $name PR $(cat "$PRS/$name.num")"
done <<< "$DEFECTS"

ok84=1; why84=""
while IFS='|' read -r name diff expect; do
  sha="$(cat "$PRS/$name.sha" 2>/dev/null)"; [ -n "$sha" ] || { ok84=0; why84="$why84 $name:no-PR;"; continue; }
  id="$(wait_run pull_request "$sha" "$EV/AC-84/ci-$name")" || { ok84=0; why84="$why84 $name:no-run;"; continue; }
  f="$EV/AC-84/ci-$name-run-$id.json"
  concl="$(jq -r .conclusion "$f")"
  first="$(awk -F'\t' '$2=="failure"{print $3; exit}' "$EV/AC-84/ci-$name-run-$id-steps.tsv")"
  printf '%s\trun=%s\tconclusion=%s\tfirstFailingStep=%s\texpected=/%s/\n' "$name" "$id" "$concl" "$first" "$expect" >> "$EV/AC-84/summary.tsv"
  if [ "$concl" = failure ] && printf '%s' "$first" | grep -Eq -- "$expect"; then :; else ok84=0; why84="$why84 $name:conclusion=$concl first=[$first];"; fi
  case "$name" in
    secret) mkdir -p "$EV/AC-24"; cp "$f" "$EV/AC-84/ci-$name-run-$id-steps.tsv" "$EV/AC-24/"; echo "$concl|$first" > "$EV/AC-24/pr-result.txt";;
    contract) mkdir -p "$EV/AC-28"; cp "$f" "$EV/AC-84/ci-$name-run-$id-steps.tsv" "$EV/AC-84/ci-$name-run-$id-failed.log" "$EV/AC-28/"; echo "$concl|$first" > "$EV/AC-28/pr-result.txt";;
  esac
done <<< "$DEFECTS"
if [ $ok84 = 1 ]; then verdict AC-84 PASS "all ten defect PRs fail CI at the matching first failing step (see AC-84/summary.tsv)"; else verdict AC-84 FAIL "$why84"; fi

# Close the throwaway PRs and delete their branches.
for n in "$PRS"/*.num; do gh pr close "$(cat "$n")" --repo $REPO --delete-branch >> "$EV/AC-84/cleanup.txt" 2>&1; done

# ---------- AC-83: CI on the unmodified published commit ----------
mkdir -p "$EV/AC-83"
gh run list --repo $REPO --workflow "Verify workspace" --branch main --limit 5 > "$EV/AC-83/run-list.txt" 2>&1
if id83="$(wait_run push "$TARGET_SHA" "$EV/AC-83/ci-main")"; then
  f="$EV/AC-83/ci-main-run-$id83.json"
  concl="$(jq -r .conclusion "$f")"
  skipped="$(awk -F'\t' '$2!="success"{print $1":"$3"="$2}' "$EV/AC-83/ci-main-run-$id83-steps.tsv" | tr '\n' ' ')"
  mins="$(jq -r '((.updatedAt|fromdate) - (.startedAt|fromdate)) / 60 | floor' "$f")"
  limit="$(awk '/timeout-minutes:/{print $2; exit}' "$CLONE/.github/workflows/verify.yml")"
  nsteps="$(wc -l < "$EV/AC-83/ci-main-run-$id83-steps.tsv" | tr -d ' ')"
  if [ "$concl" = success ] && [ -z "$skipped" ] && [ "$mins" -lt "$limit" ]; then
    verdict AC-83 PASS "run $id83 on $TARGET_SHA: success; $nsteps/$nsteps steps success, none skipped; ${mins} min < ${limit} min timeout"
  else
    verdict AC-83 FAIL "run $id83: conclusion=$concl nonSuccessSteps=[$skipped] minutes=$mins limit=$limit"
  fi
else
  verdict AC-83 FAIL "no push run of Verify workspace for $TARGET_SHA"
fi

# ---------- Combine with the CI job "github" parts ----------
PARTS="$OUT/ci-parts"; rm -rf "$PARTS"
rec _provenance download-ci-parts gh run download "$CI_RUN" --repo $REPO -n evidence-github -D "$PARTS"
for ac in AC-24 AC-28 AC-93; do [ -f "$PARTS/results/parts/$ac.json" ] && cp "$PARTS/results/parts/$ac.json" "$EV/$ac.ci-part.json" 2>/dev/null; done
part() { jq -r "$2" "$PARTS/results/parts/$1.json" 2>/dev/null || echo MISSING; }

p24="$(part AC-24 .result)"; pr24="$(cat "$EV/AC-24/pr-result.txt" 2>/dev/null)"
if [ "$p24" = PASS ] && printf '%s' "$pr24" | grep -Eq '^failure\|Run pnpm check:secrets$'; then
  verdict AC-24 PASS "CI part: $(part AC-24 .reason); PR CI failed first at 'Run pnpm check:secrets'"
else verdict AC-24 FAIL "CI part $p24 ($(part AC-24 .reason)); PR result [$pr24]"; fi

p28="$(part AC-28 .result)"; pr28="$(cat "$EV/AC-28/pr-result.txt" 2>/dev/null)"
drift_named=0; grep -Eq 'openapi\.json|api\.d\.ts|contract' "$EV"/AC-28/ci-contract-run-*-failed.log 2>/dev/null && drift_named=1
if [ "$p28" = PASS ] && printf '%s' "$pr28" | grep -Eq '^failure\|.*contract' && [ $drift_named = 1 ]; then
  verdict AC-28 PASS "CI part: $(part AC-28 .reason); PR CI failed first at a contract step naming the drifted file"
else verdict AC-28 FAIL "CI part $p28 ($(part AC-28 .reason)); PR result [$pr28] namesFile=$drift_named"; fi

# ---------- AC-93: GitHub accepted the Dependabot config ----------
mkdir -p "$EV/AC-93"
blob_main="$(gh api "repos/$REPO/contents/.github/dependabot.yml?ref=$TARGET_SHA" --jq .sha)"
gh api "repos/$REPO/actions/runs?event=dynamic&per_page=30" --jq '.workflow_runs[] | [.id, .name, .conclusion, .head_sha, .created_at] | @tsv' > "$EV/AC-93/dependabot-runs.tsv"
accepted=""; for eco in npm_and_yarn github_actions docker; do
  line="$(awk -F'\t' -v e="$eco" 'index($2, e" in ")==1 {print; exit}' "$EV/AC-93/dependabot-runs.tsv")"
  sha="$(printf '%s' "$line" | cut -f4)"; concl="$(printf '%s' "$line" | cut -f3)"
  blob="$( [ -n "$sha" ] && gh api "repos/$REPO/contents/.github/dependabot.yml?ref=$sha" --jq .sha)"
  printf '%s\tlatestRun=%s\tconclusion=%s\tconfigBlob=%s\tmainBlob=%s\n' "$eco" "$(printf '%s' "$line" | cut -f1)" "$concl" "$blob" "$blob_main" >> "$EV/AC-93/acceptance.tsv"
  [ "$concl" = success ] && [ "$blob" = "$blob_main" ] && accepted="$accepted $eco"
done
gh api "repos/$REPO/dependabot/alerts?per_page=5" > "$EV/AC-93/alerts.json" 2> "$EV/AC-93/alerts.stderr"; echo "exit=$?" >> "$EV/AC-93/alerts.stderr"
p93="$(part AC-93 .result)"
if [ "$p93" = PASS ] && [ "$accepted" = " npm_and_yarn github_actions docker" ]; then
  verdict AC-93 PASS "CI part: $(part AC-93 .reason); GitHub ran all three update jobs successfully on a config blob identical to main ($blob_main)"
else verdict AC-93 FAIL "CI part $p93; GitHub-accepted ecosystems with main's config blob: [${accepted# }]"; fi
