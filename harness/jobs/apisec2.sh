#!/bin/bash
# AC-41: bounded, deterministic attack corpus (core cases + replay of the earlier prover scripts + seeded coordinator fuzz/sweep).
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/apisec.sh"
provenance || exit 1
secrets_init
sec_env
trap sec_cleanup EXIT
if ! sec_prepare; then sec_fail_all "setup failed (install/build/infra)" AC-41; exit 0; fi
playwright_install
N="$SEC_LIB"; A41="$EV/AC-41"; mkdir -p "$A41"
kc_realm_put acme '{"accessTokenLifespan":3600}' >/dev/null     # long-lived tokens so expiry does not blur the corpus
db_new ac41_test
# High rate limit: the corpus sends thousands of authenticated calls; 429s would hide what is behind them.
api_start api 4103 ac41_test RATE_LIMIT=100000
web_start web 3103 4103 ac41
API_LOG="$SEC_LOGS/api.log"; WEB_LOG="$SEC_LOGS/web.log"

run_phase AC-41 core -- env OUT="$A41" API=http://127.0.0.1:4103 WEB=http://localhost:3103 OPENAPI="$WS/apps/api/openapi.json" node "$N/ac41core.mjs"

# ---------- replay of the earlier prover scripts ----------
R="$WORK/replay"; rm -rf "$R"; cp -R "$N/replay" "$R"
find "$R" -type f \( -name '*.mjs' -o -name '*.sh' \) -print0 | xargs -0 sed -i -E -e 's#realms/acme-z[0-9]#realms/acme#g' -e "s#'-p', '55440'#'-p', '5432'#g" -e 's#z[0-9]_main_test#ac41_test#g'
diff -ru "$N/replay" "$R" > "$A41/replay-substitutions.diff"
mkdir -p "$WORK/pz/run"; export PZ="$WORK/pz"
export OUT="$A41/replay"; mkdir -p "$OUT"
export EV_ENV_NAMES="CLONE OUT PZ ALICE_PASSWORD ACME_CLI_SECRET PG_PASSWORD"
cd_run() { # label cwd cmd...   (each replay step is bounded to 20 minutes)
  local l="$1" d="$2"; shift 2; ev_run AC-41 "replay-$l" "$d" -- timeout 1200 "$@"; echo "$l $?" >> "$A41/replay-exits.txt"; }
cd_run cap "$R/own" node cap.mjs
CID=$(jq -r .createId "$OUT/ids.json" 2>/dev/null); RID=$(jq -r .renameId "$OUT/ids.json" 2>/dev/null)
ac_check AC-41 "replay prerequisites: action ids captured" "$([ -n "$CID" ] && [ "$CID" != null ] && echo 1 || echo 0)" "createId present: $([ -n "$CID" ] && echo yes || echo no)"
for s in ac41 ac41b ac41c ac41d ac41e ac41f ac41g ac41h ac41i ac41j ac41k ac41l ac39; do cd_run "$s" "$R/scripts" node "$s.mjs"; done
cd_run cl-hang "$R/scripts" node cl-hang.mjs
cd_run cl-hang-r2i "$R/r2i" bash -c "cp cl-hang.mjs '$R/scripts/cl-hang-r2i.mjs' && cd '$R/scripts' && node cl-hang-r2i.mjs"
for s in repro-min repro-j repro-z5 repro-n1 repro-n2; do cd_run "$s" "$R/scripts" bash "$s.sh" "$CID" "$RID"; done
cd_run repro-min-r2i "$R/r2i" bash repro-min.sh "$CID" "$RID"
cd_run cors "$R/scripts" bash cors.sh
cd_run logout "$R/scripts" bash logout.sh
for s in z5a z5b z5e z5f z5g z5d bom csrf-matcher hang-verify; do cd_run "$s" "$R/own" node "$s.mjs"; done
cd_run n1 "$R/own" node n1.mjs
cd_run n2 "$R/own" node n2.mjs
cd_run n3 "$R/own" env SEED=5 N=12000 node n3.mjs
cd_run verify-patch "$R/own" env PORT=3103 node verify-patch.mjs
for sd in 21 22; do cd_run "z5c-$sd" "$R/own" node z5c.mjs 12000 $sd; done
for sd in 11 12 13; do cd_run "z5diff-$sd" "$R/own" node z5diff.mjs 100000 $sd; done
for sd in 1 2 3 4 5; do cd_run "fuzz-z3-seed$sd" "$R/scripts" node fuzz-z3.mjs "$CID" "$RID" 20000 $sd; done
for sd in 1 2 3; do cd_run "coordinator-fuzz-seed$sd" "$R/coordinator" env SEED=$sd node --import "$N/seedrandom.mjs" coordinator-fuzz.mjs http://localhost:3103 "$CID" "$RID" 10000; done
cd_run coordinator-sweep "$R/coordinator" node coordinator-sweep.mjs 3103 "$CID"
unset OUT

# ---------- verdict inputs ----------
cp "$API_LOG" "$A41/api-main.log"; cp "$WEB_LOG" "$A41/web-main.log"
a5=$(log5xx "$API_LOG"); w5=$(log5xx "$WEB_LOG")
ac_check AC-41 "zero 5xx in the API log" "$([ "$a5" = 0 ] && echo 1 || echo 0)" "5xx lines: $a5"
ac_check AC-41 "zero 5xx in the web log" "$([ "$w5" = 0 ] && echo 1 || echo 0)" "5xx lines: $w5"
for f in "$A41"/replay-*.stdout; do :; done
m5=$(cat "$A41"/replay-*.stdout 2>/dev/null | grep -cE '^5XX |HTTP 5[0-9][0-9]( |$)')
ac_check AC-41 "no replayed script printed a 5xx response" "$([ "$m5" = 0 ] && echo 1 || echo 0)" "5xx markers in replay output: $m5"
jq -R 'fromjson? | select((.event=="request.complete") and (.status>=500)) | {method,route,status}' "$WEB_LOG" "$API_LOG" 2>/dev/null | jq -s 'group_by(.method+.route+(.status|tostring))|map({k:(.[0]|[.method,.route,.status]|join(" ")),n:length})' > "$A41/5xx-summary.json"
nz=$(awk '$2!=0' "$A41/replay-exits.txt" | tr '\n' ' ')
verdict_from AC-41 "replay script nonzero exits (informational): ${nz:-none}"
exit 0
