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
# AC-41 runs in six shards whose evidence files intentionally share names. Preserve each complete shard instead of
# leaving whichever artifact happened to copy last at evidence/AC-41.
rm -rf "$OUT/all/evidence/AC-41"; mkdir -p "$OUT/all/evidence/AC-41/shards"
for d in "$OUT"/ci/evidence-*; do
  for part in "$d"/results/parts/AC-41-*.json; do
    [ -f "$part" ] || continue
    shard="$(jq -er '.shard' "$part")"
    [ -d "$d/evidence/AC-41" ] || { echo "AC-41 shard $shard has no evidence directory" >&2; exit 1; }
    [ ! -e "$OUT/all/evidence/AC-41/shards/$shard" ] || { echo "duplicate AC-41 shard $shard" >&2; exit 1; }
    mkdir -p "$OUT/all/evidence/AC-41/shards/$shard"
    cp -R "$d/evidence/AC-41/." "$OUT/all/evidence/AC-41/shards/$shard/"
  done
done
jq -s 'map({shard,result,reason,job,commit,evidence:("shards/" + .shard)}) | sort_by(.shard)' \
  "$OUT"/all/results/parts/AC-41-*.json > "$OUT/all/evidence/AC-41/manifest.json"
# The local PR evidence and verdicts complete AC-24, AC-28, AC-83, AC-84 and AC-93.
cp -R "$PRS/evidence/." "$OUT/all/evidence/"; cp "$PRS"/results/AC-*.json "$OUT/all/results/"
node "$HERE/aggregate.mjs" "$OUT/all" > /dev/null
node "$HERE/finalize-deferred.mjs" "$OUT/all"
node "$HERE/aggregate.mjs" "$OUT/all" > "$OUT/SUMMARY.md"
echo "run: $RUN  https://github.com/rhyumiranda/scaffold-turbo-proof/actions/runs/$RUN" > "$OUT/ci/RUN.txt"
head -3 "$OUT/SUMMARY.md"
