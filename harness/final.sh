#!/bin/bash
# Final combination on the owner's machine: CI evidence of one full run plus the local GitHub-criteria evidence.
# usage: final.sh <out-dir> <ci-run-id> <prs-out-dir>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$1"; RUN="$2"; PRS="$3"
rm -rf "$OUT"; mkdir -p "$OUT/ci"
gh run download "$RUN" --repo rhyumiranda/scaffold-turbo-proof -p 'evidence-*' -D "$OUT/ci"
mkdir -p "$OUT/all/evidence" "$OUT/all/results/parts"
for d in "$OUT"/ci/evidence-*; do cp -R "$d/evidence/." "$OUT/all/evidence/"; cp -R "$d/results/." "$OUT/all/results/"; done
# The local PR evidence and verdicts complete AC-24, AC-28, AC-83, AC-84 and AC-93.
cp -R "$PRS/evidence/." "$OUT/all/evidence/"; cp "$PRS"/results/AC-*.json "$OUT/all/results/"
node "$HERE/aggregate.mjs" "$OUT/all" > /dev/null
node "$HERE/finalize-deferred.mjs" "$OUT/all"
node "$HERE/aggregate.mjs" "$OUT/all" > "$OUT/SUMMARY.md"
echo "run: $RUN  https://github.com/rhyumiranda/scaffold-turbo-proof/actions/runs/$RUN" > "$OUT/ci/RUN.txt"
head -3 "$OUT/SUMMARY.md"
