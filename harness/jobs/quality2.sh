#!/bin/bash
# AC-74: sabotage tests. Each sabotage lives on its own throwaway branch; suites run cheapest first and stop at the first red one.
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/quality.sh"
provenance || exit 1
secrets_init
fail_all() { verdict AC-74 FAIL "$1"; scrub_secrets; exit 0; }
setup_quality fail_all || exit 0
SUITES="lint check:arch test:unit test:integration test:runtime test:e2e"
ID=(-c user.name="Rhyu Miranda" -c user.email=rhyu.agapito.miranda@gmail.com)
ok=1; why=""
declare -A caught_by

# run_suites N: runs suites in order on the current branch; stops at the first failing one. Echoes the name or "none".
run_suites() {
  local n="$1" s db l code
  for s in $SUITES; do
    db="q74_s${n}_${s//[:]/_}_test"; db="${db//-/_}"; l="s$n-${s//:/_}"
    ev_run AC-74 "createdb-$l" -- pg_createdb "$db" || { echo "harness-error"; return; }
    suite AC-74 "$l" "$db" "$s"; code=$?
    echo "$s exit=$code" >> "$EV/AC-74/s$n-summary.txt"
    if [ "$code" != 0 ]; then
      merged AC-74 "$l" > /dev/null
      grep -nE 'not ok|✘|✖|error|Error|failed' "$EV/AC-74/$l.out" 2>/dev/null | head -8 > "$EV/AC-74/s$n-first-failures.txt"
      echo "$s"; return
    fi
  done
  echo none
}

for n in 0 1 2 3 4 5 6 7 8 9 10; do
  mkdir -p "$EV/AC-74"; : > "$EV/AC-74/s$n-summary.txt"
  git -C "$WS" switch -q -c "sabotage/AC-74-$n" || { ok=0; why="$why s$n branch failed;"; continue; }
  if [ "$n" != 0 ]; then
    python3 "$HARNESS/infra/quality2/sabotage.py" "$n" "$WS" > "$EV/AC-74/s$n-apply.txt" 2>&1 || { ok=0; why="$why s$n patch did not apply;"; }
    git -C "$WS" "${ID[@]}" commit -qam "test(AC-74): sabotage $n"
    git -C "$WS" diff HEAD~1 HEAD > "$EV/AC-74/s$n.diff"
  fi
  res="$(run_suites "$n" | tail -1)"
  caught_by[$n]="$res"
  # Proof file: the diff that changed behaviour plus the failing assertion lines (or NOT CAUGHT).
  { echo "== sabotage $n: caught by $res"; echo "== diff"; cat "$EV/AC-74/s$n.diff" 2>/dev/null; echo "== failing assertions"
    if [ "$res" = none ]; then echo "NOT CAUGHT: every suite stayed green"; else cat "$EV/AC-74/s$n-first-failures.txt" 2>/dev/null; fi; } > "$EV/AC-74/s$n-proof.txt"
  echo "sabotage $n caught by: $res" | tee -a "$EV/AC-74/summary.txt"
  git -C "$WS" switch -q --detach "$TARGET_SHA" && [ "$(git -C "$WS" rev-parse HEAD)" = "$TARGET_SHA" ] || { ok=0; why="$why could not return to target after s$n;"; break; }
  git -C "$WS" branch -q -D "sabotage/AC-74-$n"
done

[ "${caught_by[0]:-}" = none ] || { ok=0; why="$why baseline (no sabotage) was not green: ${caught_by[0]:-missing};"; }
total=0; sec_missed=""
for n in 1 2 3 4 5 6 7 8 9 10; do
  r="${caught_by[$n]:-missing}"
  case "$r" in none|missing|harness-error) ;; *) total=$((total + 1));; esac
  case " 1 2 3 4 6 7 8 " in *" $n "*) case "$r" in none|missing|harness-error) sec_missed="$sec_missed $n";; esac;; esac
done
[ -z "$sec_missed" ] || { ok=0; why="$why security/data sabotages not caught:$sec_missed;"; }
[ "$total" -ge 9 ] || { ok=0; why="$why only $total of 10 caught;"; }
detail="$(for n in 1 2 3 4 5 6 7 8 9 10; do printf 's%s=%s ' "$n" "${caught_by[$n]:-missing}"; done)"
if [ $ok = 1 ]; then verdict AC-74 PASS "baseline green; $total of 10 sabotages caught, including 1,2,3,4,6,7,8: $detail"
else verdict AC-74 FAIL "${why# } [$detail]"; fi
scrub_secrets
