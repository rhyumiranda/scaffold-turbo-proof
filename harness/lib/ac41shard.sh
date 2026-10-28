# AC-41 sharded corpus. ac41_shard NAME runs one shard of the full, fixed-seed corpus on its own runner and writes
# results/parts/AC-41-NAME.json (it never writes results/AC-41.json; the aggregation step combines the parts).
# Shards: core (core cases + ac41*/ac39/repros) | own (own attacks) | diff (n3, z5c, z5diff) | fuzzA (fuzz-z3 seeds 1-3) | fuzzB (fuzz-z3 seeds 4-5 + coordinator fuzz/sweep)
ac41_part() { # NAME RESULT REASON
  mkdir -p "$RES/parts"
  python3 - "$RES/parts/AC-41-$1.json" "$1" "$2" "$3" "$JOB" "${TARGET_SHA:-}" <<'PY'
import json,sys
p,shard,result,reason,job,sha=sys.argv[1:]
json.dump({"ac":"AC-41","shard":shard,"result":result,"reason":reason,"job":job,"commit":sha},open(p,"w"),indent=2)
PY
  echo "AC-41 shard $1 $2 - $3"
}
ac41_shard() {
  local SH="$1" N="$SEC_LIB" A41="$EV/AC-41"; mkdir -p "$A41"
  provenance || exit 1
  secrets_init; sec_env; trap sec_cleanup EXIT
  if ! sec_prepare; then ac41_part "$SH" FAIL "setup failed (install/build/infra)"; return 0; fi
  playwright_install
  kc_realm_put acme '{"accessTokenLifespan":3600}' >/dev/null
  db_new ac41_test
  api_start api 4103 ac41_test RATE_LIMIT=100000
  web_start web 3103 4103 ac41
  local API_LOG="$SEC_LOGS/api.log" WEB_LOG="$SEC_LOGS/web.log"
  local R="$WORK/replay"; rm -rf "$R"; cp -R "$N/replay" "$R"
  find "$R" -type f \( -name '*.mjs' -o -name '*.sh' \) -print0 | xargs -0 sed -i -E -e 's#realms/acme-z[0-9]#realms/acme#g' -e "s#'-p', '55440'#'-p', '5432'#g" -e 's#z[0-9]_main_test#ac41_test#g'
  diff -ru "$N/replay" "$R" > "$A41/replay-substitutions.diff"
  mkdir -p "$WORK/pz/run"; export PZ="$WORK/pz"
  export OUT="$A41/replay"; mkdir -p "$OUT"
  export EV_ENV_NAMES="CLONE OUT PZ ALICE_PASSWORD ACME_CLI_SECRET PG_PASSWORD"
  cd_run() { local l="$1" d="$2"; shift 2; ev_run AC-41 "replay-$l" "$d" -- timeout 1500 "$@"; echo "$l $?" >> "$A41/replay-exits.txt"; }
  if [ "$SH" = core ]; then
    run_phase AC-41 core -- env OUT="$A41" API=http://127.0.0.1:4103 WEB=http://localhost:3103 OPENAPI="$WS/apps/api/openapi.json" node "$N/ac41core.mjs"
  fi
  cd_run cap "$R/own" node cap.mjs
  local CID RID
  CID=$(jq -r .createId "$OUT/ids.json" 2>/dev/null); RID=$(jq -r .renameId "$OUT/ids.json" 2>/dev/null)
  ac_check AC-41 "prerequisite: Server Action ids captured" "$([ -n "$CID" ] && [ "$CID" != null ] && echo 1 || echo 0)"
  local s sd
  case "$SH" in
  core)
    for s in ac41 ac41b ac41c ac41d ac41e ac41f ac41g ac41h ac41i ac41j ac41k ac41l ac39; do cd_run "$s" "$R/scripts" node "$s.mjs"; done
    cd_run cl-hang "$R/scripts" node cl-hang.mjs
    cd_run cl-hang-r2i "$R/r2i" bash -c "cp cl-hang.mjs '$R/scripts/cl-hang-r2i.mjs' && cd '$R/scripts' && node cl-hang-r2i.mjs"
    for s in repro-min repro-j repro-z5 repro-n1 repro-n2; do cd_run "$s" "$R/scripts" bash "$s.sh" "$CID" "$RID"; done
    cd_run repro-min-r2i "$R/r2i" bash repro-min.sh "$CID" "$RID"
    cd_run cors "$R/scripts" bash cors.sh
    cd_run logout "$R/scripts" bash logout.sh ;;
  own)
    for s in z5a z5b z5e z5f z5g z5d bom csrf-matcher hang-verify n1 n2; do cd_run "$s" "$R/own" node "$s.mjs"; done
    cd_run verify-patch "$R/own" env PORT=3103 node verify-patch.mjs ;;
  diff)
    cd_run n3 "$R/own" env SEED=5 N=12000 node n3.mjs
    for sd in 21 22; do cd_run "z5c-$sd" "$R/own" node z5c.mjs 12000 $sd; done
    for sd in 11 12 13; do cd_run "z5diff-$sd" "$R/own" node z5diff.mjs 100000 $sd; done ;;
  fuzzA)
    for sd in 1 2 3; do cd_run "fuzz-z3-seed$sd" "$R/scripts" node fuzz-z3.mjs "$CID" "$RID" 20000 $sd; done ;;
  fuzzB)
    for sd in 4 5; do cd_run "fuzz-z3-seed$sd" "$R/scripts" node fuzz-z3.mjs "$CID" "$RID" 20000 $sd; done
    for sd in 1 2 3; do cd_run "coordinator-fuzz-seed$sd" "$R/coordinator" env SEED=$sd node --import "$N/seedrandom.mjs" coordinator-fuzz.mjs http://localhost:3103 "$CID" "$RID" 10000; done
    cd_run coordinator-sweep "$R/coordinator" node coordinator-sweep.mjs 3103 "$CID" ;;
  esac
  unset OUT
  cp "$API_LOG" "$A41/api-main.log"; cp "$WEB_LOG" "$A41/web-main.log"
  local a5 w5 m5 nz
  a5=$(log5xx "$API_LOG"); w5=$(log5xx "$WEB_LOG")
  ac_check AC-41 "zero 5xx in the API log" "$([ "$a5" = 0 ] && echo 1 || echo 0)" "5xx lines: $a5"
  ac_check AC-41 "zero 5xx in the web log" "$([ "$w5" = 0 ] && echo 1 || echo 0)" "5xx lines: $w5"
  m5=$(cat "$A41"/replay-*.stdout 2>/dev/null | grep -cE '^5XX |HTTP 5[0-9][0-9]( |$)')
  ac_check AC-41 "no replayed script printed a 5xx response" "$([ "$m5" = 0 ] && echo 1 || echo 0)" "markers: $m5"
  jq -R 'fromjson? | select((.event=="request.complete") and (.status>=500)) | {method,route,status}' "$WEB_LOG" "$API_LOG" 2>/dev/null | jq -s 'group_by(.method+.route+(.status|tostring))|map({k:(.[0]|[.method,.route,.status]|join(" ")),n:length})' > "$A41/5xx-summary.json"
  nz=$(awk '$2!=0' "$A41/replay-exits.txt" 2>/dev/null | tr '\n' ' ')
  local f="$A41/assert.json" total failed
  total=$(jq '.checks|length' "$f"); failed=$(jq '[.checks[]|select(.ok|not)]|length' "$f")
  if [ "$failed" = 0 ] && [ "$total" -gt 0 ]; then ac41_part "$SH" PASS "$total/$total checks passed; zero 5xx in API/web logs; replay nonzero exits (informational): ${nz:-none}"
  else ac41_part "$SH" FAIL "$failed/$total failed: $(jq -r '[.checks[]|select(.ok|not)|.label]|join("; ")' "$f" | cut -c1-500); replay nonzero exits: ${nz:-none}"; fi
}
