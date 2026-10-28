# shellcheck shell=bash disable=SC2034
# Helpers for the turbo job (AC-13 .. AC-18, AC-21).
DUCKTORS_IMAGE="ducktors/turborepo-remote-cache:2.14.3@sha256:781b0549dca80cf5aca27bf416fc766d44cad57333a7368098a755c5f12b8822"
mkdir -p "$WORK/tmp"

# restore_main   Back to the pristine generated commit: tracked files, untracked fixtures and throwaway branches.
restore_main() {
  git -C "$WS" reset -q --hard "$TARGET_SHA"
  git -C "$WS" clean -fdq
  git -C "$WS" switch -q --detach "$TARGET_SHA" || { echo "FATAL: cannot return to $TARGET_SHA"; exit 1; }
  [ "$(git -C "$WS" rev-parse HEAD)" = "$TARGET_SHA" ] || { echo "FATAL: HEAD is not the target commit"; exit 1; }
  git -C "$WS" for-each-ref --format='%(refname:short)' 'refs/heads/throwaway/*' | while read -r b; do git -C "$WS" branch -q -D "$b"; done
}
# neg_start AC label   Fresh throwaway branch from the generated commit.
neg_start() { restore_main; git -C "$WS" switch -q -c "throwaway/$1-$2"; }
# put PATH   Writes stdin to PATH inside the clone (creating folders).
put() { mkdir -p "$(dirname "$WS/$1")"; cat > "$WS/$1"; }
# fixture_diff AC label   Saves the throwaway branch's diff (untracked files included).
fixture_diff() { ev_run "$1" "$2-diff" -- bash -c 'git add -N . && git diff'; }
reinstall() { ev_run "$1" "$2-reinstall" -- pnpm install --frozen-lockfile; }

# Starts and stops the test services (compose project from common.sh).
infra_down() { ( cd "$HARNESS/infra" && docker compose down -v --remove-orphans ) >/dev/null 2>&1 || true; }

# last_summary   Newest turbo run summary file of the clone.
last_summary() { ls -t "$WS"/.turbo/runs/*.json 2>/dev/null | head -1; }
# tasks_tsv SUMMARY OUT   taskId <TAB> cache status <TAB> source, sorted.
tasks_tsv() { jq -r '.tasks[] | [.taskId, .cache.status, (if (.cache.remote == true or .cache.source == "REMOTE") then "REMOTE" else "LOCAL" end)] | @tsv' "$1" | LC_ALL=C sort > "$2"; }
# want_status TSV STATUS CSV   Every task matching a pattern in CSV (exact id or trailing *) must have STATUS; each pattern must match.
want_status() {
  local f="$1" want="$2" csv="$3" p ids id st
  local -a pats
  IFS=',' read -ra pats <<< "$csv"
  for p in "${pats[@]}"; do
    ids="$(awk -F'\t' -v p="$p" 'BEGIN{pre=0; if (p ~ /\*$/) {sub(/\*$/,"",p); pre=1}} { if ((pre && index($1,p)==1) || (!pre && $1==p)) print $1"\t"$2 }' "$f")"
    [ -n "$ids" ] || { echo "no task matches $p"; return 1; }
    while IFS=$'\t' read -r id st; do [ "$st" = "$want" ] || { echo "$id is $st, wanted $want"; return 1; }; done <<< "$ids"
  done
  return 0
}
