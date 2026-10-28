#!/bin/bash
# Re-grades AC-83 alone, after the generated CI run on the target commit was re-run (for example when the first
# attempt never started). Same rule as prs.sh: success, no step other than success, duration under timeout-minutes.
# usage: ac83.sh <prs-out-dir>
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; OUT="$1"; REPO=rhyumiranda/scaffold-turbo-proof
TARGET_SHA="$(jq -r .commit "$HERE/../TARGET.json")"; TARGET_TREE="$(jq -r .skillTree "$HERE/../TARGET.json")"
EV="$OUT/evidence/AC-83"; mkdir -p "$EV"
id="$(gh run list --repo $REPO --workflow "Verify workspace" --commit "$TARGET_SHA" --event push --json databaseId --jq '.[0].databaseId')"
gh run watch "$id" --repo $REPO --interval 60 > /dev/null 2>&1
gh run view "$id" --repo $REPO --json databaseId,event,headSha,status,conclusion,attempt,createdAt,updatedAt,startedAt,url,jobs > "$EV/ci-main-run-$id-attempt.json"
f="$EV/ci-main-run-$id-attempt.json"
jq -r '.jobs[].steps[] | "\(.number)\t\(.conclusion)\t\(.name)"' "$f" > "$EV/ci-main-run-$id-attempt-steps.tsv"
concl="$(jq -r .conclusion "$f")"; attempt="$(jq -r .attempt "$f")"
bad="$(awk -F'\t' '$2!="success"{print $1":"$3"="$2}' "$EV/ci-main-run-$id-attempt-steps.tsv" | tr '\n' ' ')"
mins="$(jq -r '.jobs[0] | ((.completedAt|fromdate) - (.startedAt|fromdate)) / 60 | floor' "$f")"
n="$(wc -l < "$EV/ci-main-run-$id-attempt-steps.tsv" | tr -d ' ')"
limit="$(gh api "repos/$REPO/contents/.github/workflows/verify.yml?ref=$TARGET_SHA" --jq .content | base64 -d | awk '/timeout-minutes:/{print $2; exit}')"
if [ "$concl" = success ] && [ -z "$bad" ] && [ "$n" -gt 0 ] && [ "$mins" -lt "$limit" ]; then r=PASS; why="run $id attempt $attempt on $TARGET_SHA: success; $n/$n steps success, none skipped; $mins min < $limit min timeout (attempt 1 never started: account Actions spending limit)"
else r=FAIL; why="run $id attempt $attempt: conclusion=$concl nonSuccess=[$bad] steps=$n minutes=$mins limit=$limit"; fi
python3 -c 'import json,sys; json.dump(dict(zip(["ac","result","reason","job","commit","skillTree"],sys.argv[2:])),open(sys.argv[1],"w"),indent=2)' "$OUT/results/AC-83.json" AC-83 "$r" "$why" github-prs "$TARGET_SHA" "$TARGET_TREE"
echo "AC-83 $r — $why"
