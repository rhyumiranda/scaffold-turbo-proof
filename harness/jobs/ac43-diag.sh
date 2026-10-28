#!/bin/bash
# Diagnostic run for AC-43 only: where does the post-expiry Redis memory delta live? (read-only Redis commands)
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/apisec.sh"
provenance || exit 1
secrets_init
sec_env
trap sec_cleanup EXIT
if ! sec_prepare; then sec_fail_all "setup failed" AC-43; exit 0; fi
db_new ac22_test
redis_up sec-sesredis 6381
api_start ac43api 4143 ac22_test
web_start ac43 3143 4143 ac43 AUTH_REDIS_URL=redis://127.0.0.1:6381
run_phase AC-43 run -- env OUT="$EV/AC-43" WEB=http://localhost:3143 RPORT=6381 NS=ac43 DIAG=1 node "$SEC_LIB/ac43.mjs"
svc_stop ac43; svc_stop ac43api
verdict_from AC-43 "diagnostic run (ac43-diag): see AC-43/diag/delta-by-field.json"
exit 0
