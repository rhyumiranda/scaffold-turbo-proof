#!/bin/bash
# API security: AC-22, AC-31, AC-36, AC-37, AC-42, AC-43 (AC-41 runs in apisec2).
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/apisec.sh"
ACS="AC-22 AC-31 AC-36 AC-37 AC-42 AC-43"
provenance || exit 1
secrets_init
sec_env
trap sec_cleanup EXIT
if ! sec_prepare; then sec_fail_all "setup failed (install/build/infra); see _setup-$JOB" $ACS; exit 0; fi
toxi_up || echo "toxiproxy failed to start"
N="$SEC_LIB"
PGU() { echo "postgresql://postgres:$PG_PASSWORD@127.0.0.1:5432/$1"; }

# Real expired token for AC-36: realm lifespan 60 s, mint, restore 300 s.
kc_realm_put acme '{"accessTokenLifespan":60}' >/dev/null
( cd "$WORK" && umask 077 && node -e '
const e=process.env;fetch(e.KC_URL+"/realms/acme/protocol/openid-connect/token",{method:"POST",body:new URLSearchParams({grant_type:"password",client_id:"acme-cli",client_secret:e.ACME_CLI_SECRET,username:"alice",password:e.ALICE_PASSWORD,scope:"openid"})}).then(r=>r.json()).then(j=>require("fs").writeFileSync("expiry.jwt",j.access_token))' )
kc_realm_put acme '{"accessTokenLifespan":300}' >/dev/null

# ---------- AC-22 ----------
db_new ac22_test
export AC22_DB=ac22_test
run_phase AC-22 run -- env OUT="$EV/AC-22" node "$N/ac22.mjs"
verdict_from AC-22

# ---------- AC-31 ----------
db_new ac31_test
api_start ac31 4131 ac31_test DATABASE_URL="postgresql://postgres:$PG_PASSWORD@127.0.0.1:15432/ac31_test"
api_start ac31rl 4132 ac31_test RATE_LIMIT=3
run_phase AC-31 run -- env OUT="$EV/AC-31" API=http://127.0.0.1:4131 API_RL=http://127.0.0.1:4132 TOXI=http://127.0.0.1:8474 node "$N/ac31.mjs"
svc_stop ac31; svc_stop ac31rl
verdict_from AC-31

# ---------- AC-36 ----------
db_new ac36_test
( cd "$WORK" && env OUT="$EV/AC-36" node "$N/fakeiss.mjs" 4138 "$WORK/fake-tokens.json" > "$SEC_LOGS/fakeiss.log" 2>&1 & echo $! > "$SEC_RUN/fakeiss.pid" )
for i in $(seq 1 20); do [ -s "$WORK/fake-tokens.json" ] && break; sleep 1; done
FAKE_ISS="http://127.0.0.1:4138/realms/fake"
api_start ac36 4136 ac36_test
api_start ac36fake 4137 ac36_test AUTH_ISSUER="$FAKE_ISS" AUTH_JWKS_URL=http://127.0.0.1:4138/certs
run_phase AC-36 run -- env OUT="$EV/AC-36" API=http://127.0.0.1:4136 API_FAKE=http://127.0.0.1:4137 TOKFILE="$WORK/fake-tokens.json" EXPIRY_TOKEN_FILE="$WORK/expiry.jwt" DB=ac36_test node "$N/ac36.mjs"
svc_stop ac36; svc_stop ac36fake; svc_stop fakeiss
verdict_from AC-36

# ---------- AC-37 ----------
db_new ac37_test
api_start ac37 4137 ac37_test AUTH_JWKS_COOLDOWN_MS=30000 AUTH_JWKS_CACHE_MS=120000
run_phase AC-37 run -- env OUT="$EV/AC-37" API=http://127.0.0.1:4137 COOLDOWN_MS=30000 CACHE_MS=120000 node "$N/ac37.mjs"
starts=$(grep -c '"event":"startup.ready"' "$SEC_LOGS/ac37.log")
ac_check AC-37 "API was not restarted (exactly one startup.ready)" "$([ "$starts" = 1 ] && echo 1 || echo 0)" "startup.ready lines: $starts"
n5=$(log5xx "$SEC_LOGS/ac37.log")
ac_check AC-37 "zero 5xx in the API log" "$([ "$n5" = 0 ] && echo 1 || echo 0)" "5xx lines: $n5"
svc_stop ac37
verdict_from AC-37

# ---------- AC-42 ----------
db_new ac42_test
redis_up sec-limredis 6380
P=(env OUT="$EV/AC-42" TOXI=http://127.0.0.1:8474 LIM_REDIS=sec-limredis)
api_start lim-a 4142 ac42_test RATE_LIMIT=20 RATE_WINDOW_MS=60000
run_phase AC-42 single -- "${P[@]}" P_A=4142 node "$N/ac42.mjs" single
svc_stop lim-a
api_start lim-a 4142 ac42_test RATE_LIMIT=20 RATE_WINDOW_MS=60000
run_phase AC-42 xff -- "${P[@]}" P_A=4142 node "$N/ac42.mjs" xff
svc_stop lim-a
RED="LIMITER_MODE=redis LIMITER_REDIS_URL=redis://127.0.0.1:6380 RATE_LIMIT=20 RATE_WINDOW_MS=60000"
api_start lim-a 4142 ac42_test $RED LIMITER_NAMESPACE=lim-dual
api_start lim-b 4143 ac42_test $RED LIMITER_NAMESPACE=lim-dual
run_phase AC-42 dual -- "${P[@]}" P_A=4142 P_B=4143 node "$N/ac42.mjs" dual
svc_stop lim-a; svc_stop lim-b
api_start lim-a 4142 ac42_test $RED LIMITER_NAMESPACE=lim-out
api_start lim-b 4143 ac42_test $RED LIMITER_NAMESPACE=lim-out
run_phase AC-42 outage -- "${P[@]}" P_A=4142 P_B=4143 node "$N/ac42.mjs" outage
svc_stop lim-a; svc_stop lim-b
api_start lim-c 4145 ac42_test RATE_LIMIT=1000 MAX_IN_FLIGHT=5 DATABASE_URL="postgresql://postgres:$PG_PASSWORD@127.0.0.1:15432/ac42_test"
run_phase AC-42 overload -- "${P[@]}" P_A=4145 node "$N/ac42.mjs" overload
svc_stop lim-c
db_new ac42prof_test
(
  test_env
  export DATABASE_URL="postgresql://postgres:$PG_PASSWORD@127.0.0.1:5432/ac42prof_test" TEST_REDIS_URL=redis://127.0.0.1:6380
  export EV_ENV_NAMES="NODE_ENV DATABASE_URL TEST_REDIS_URL"
  ev_run AC-42 test-profiles -- pnpm --filter @repo/api test:profiles
)
tp=$(cat "$EV/AC-42/test-profiles.exit")
ac_check AC-42 "pnpm --filter @repo/api test:profiles exits 0" "$([ "$tp" = 0 ] && echo 1 || echo 0)" "exit $tp"
sk=$(grep -E '^(ℹ|#) skipped' "$EV/AC-42/test-profiles.stdout" | grep -vc ' 0$')
ac_check AC-42 "test:profiles reports no skipped tests" "$([ "$sk" = 0 ] && echo 1 || echo 0)" "lines with skips: $sk"
verdict_from AC-42

# ---------- AC-43 ----------
redis_up sec-sesredis 6381
api_start ac43api 4143 ac22_test
web_start ac43 3143 4143 ac43 AUTH_REDIS_URL=redis://127.0.0.1:6381
run_phase AC-43 run -- env OUT="$EV/AC-43" WEB=http://localhost:3143 RPORT=6381 NS=ac43 node "$N/ac43.mjs"
svc_stop ac43; svc_stop ac43api
verdict_from AC-43
exit 0
