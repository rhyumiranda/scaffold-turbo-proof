#!/bin/bash
# OIDC security: AC-32, AC-33, AC-34, AC-35, AC-38, AC-39, AC-40.
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/apisec.sh"
ACS="AC-32 AC-33 AC-34 AC-35 AC-38 AC-39 AC-40"
provenance || exit 1
secrets_init
sec_env
trap sec_cleanup EXIT
if ! sec_prepare; then sec_fail_all "setup failed (install/build/infra); see _setup-$JOB" $ACS; exit 0; fi
playwright_install
O="$HARNESS/lib/oidc"
db_new oidc_test; db_new ident_test
export EV_ENV_NAMES="CLONE OUT ALICE_PASSWORD BOB_PASSWORD PG_PASSWORD KC_ADMIN_PASSWORD"

# ---------- AC-32 ----------
ev_run AC-32 test-identity -- env TEST_REDIS_URL=redis://127.0.0.1:6379/1 pnpm --filter @repo/web test:identity
ev_run AC-32 test-identity-browser -- env NODE_ENV=test DATABASE_URL="postgresql://postgres:$PG_PASSWORD@127.0.0.1:5432/ident_test" TEST_REDIS_URL=redis://127.0.0.1:6379/2 pnpm --filter @repo/web test:identity:browser
tracked_clean AC-32 status-after-tests
tc=$?
api_start api 4103 oidc_test RATE_LIMIT=1000
web_start web 3103 4103 oidc
export WEB=http://localhost:3103 API=http://127.0.0.1:4103 NS=oidc DB=oidc_test API_LOG="$SEC_LOGS/api.log"
run_phase AC-32 run -- env OUT="$EV/AC-32" node "$O/ac32.mjs"
for t in test-identity test-identity-browser; do ac_check AC-32 "pnpm $t exit 0 (bundled test issuer only; no external-issuer support)" "$([ "$(cat "$EV/AC-32/$t.exit")" = 0 ] && echo 1 || echo 0)" "exit $(cat "$EV/AC-32/$t.exit")"; done
ac_check AC-32 "zero source edits: git status of tracked files empty after the tests" "$([ $tc = 0 ] && echo 1 || echo 0)"
verdict_from AC-32

# ---------- AC-33 ----------
run_phase AC-33 run -- env OUT="$EV/AC-33" node "$O/ac33.mjs"
verdict_from AC-33

# ---------- AC-38 ----------
run_phase AC-38 run -- env OUT="$EV/AC-38" node "$O/ac38.mjs"
verdict_from AC-38

# ---------- AC-39 ----------
api_start cors-a 4194 oidc_test
api_start cors-b 4195 oidc_test WEB_ORIGIN=http://localhost:3000
run_phase AC-39 run -- env OUT="$EV/AC-39" API_A=http://127.0.0.1:4194 API_B=http://127.0.0.1:4195 node "$O/ac39.mjs"
svc_stop cors-a; svc_stop cors-b
verdict_from AC-39
svc_stop web

# ---------- AC-35 (session 60 s, access token 60 s) ----------
kc_realm_put acme '{"accessTokenLifespan":60}' >/dev/null
web_start web35 3103 4103 ac35 AUTH_SESSION_SECONDS=60
export NS=ac35
run_phase AC-35 run -- env OUT="$EV/AC-35" DOCS="$WS/apps/web/docs/production-profiles.md" node "$O/ac35.mjs"
svc_stop web35
kc_realm_put acme '{"accessTokenLifespan":300}' >/dev/null
verdict_from AC-35
svc_stop api

# ---------- HTTPS fixture (AC-34, AC-40) ----------
T=/tmp/acc-tls   # space-free path (WORK contains a space)
bash "$HARNESS/infra/oidc/gen-certs.sh" "$T" || sec_fail_all "certificate generation failed" AC-34 AC-40
export SPKI="$(cat "$T/spki.txt")"
echo "127.0.0.1 app.acme.test id.acme.test" | sudo tee -a /etc/hosts >/dev/null
docker run -d --name sec-caddy --network host --cpus=2 --memory=2g -v "$HARNESS/infra/oidc/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$T:/certs:ro" "$CADDY_IMAGE" >/dev/null
kc_realm_put acme '{"attributes":{"frontendUrl":"https://id.acme.test:8443"}}' >/dev/null
sleep 3
ev_run AC-34 fixture-discovery -- curl -sS --cacert "$T/ca.crt" https://id.acme.test:8443/realms/acme/.well-known/openid-configuration
ISS_TLS="https://id.acme.test:8443/realms/acme"
APIX="NODE_ENV=production AUTH_ISSUER=$ISS_TLS AUTH_JWKS_URL=$ISS_TLS/protocol/openid-connect/certs NODE_EXTRA_CA_CERTS=$T/ca.crt"
export API_UP_CMD="api_start apis 4103 oidc_test $APIX"
export API_DOWN_CMD="svc_stop apis"
bash -c "$API_UP_CMD"
export WEB_HTTPS=1
web_start webs 3101 4103 tls AUTH_APP_ORIGIN=https://app.acme.test:8443 AUTH_ISSUER=$ISS_TLS NODE_EXTRA_CA_CERTS="$T/ca.crt"
ac_check AC-34 "HTTPS fixture serves the app through Caddy" "$([ "$(curl -s -o /dev/null -w '%{http_code}' --cacert "$T/ca.crt" https://app.acme.test:8443/healthz)" = 200 ] && echo 1 || echo 0)"
export WEB=https://app.acme.test:8443 NS=tls API=http://127.0.0.1:4103
run_phase AC-34 run -- env OUT="$EV/AC-34" node "$O/ac34.mjs"
verdict_from AC-34

# ---------- AC-40 ----------
run_phase AC-40 journey -- env OUT="$EV/AC-40" NODE_EXTRA_CA_CERTS="$T/ca.crt" node "$O/ac40.mjs"
Z="$EV/AC-40/zap"; mkdir -p "$Z"; chmod 777 "$Z"
zap() { # name url
  ev_run AC-40 "zap-$1" -- timeout 1200 docker run --rm --network host --add-host app.acme.test:127.0.0.1 --add-host id.acme.test:127.0.0.1 --cpus=2 --memory=2g -v "$Z:/zap/wrk:rw" "$ZAP_IMAGE" zap-baseline.py -t "$2" -J "$1.json" -r "$1.html" -I -m 2; }
# The app redirects to Keycloak, and ZAP attributes the IdP page to the app URL. Stub the IdP (as the earlier prover did) so the web scan sees only the app.
docker rm -f sec-caddy >/dev/null
docker run -d --name sec-caddy2 --network host --cpus=2 --memory=2g -v "$HARNESS/infra/oidc/Caddyfile.idpstub:/etc/caddy/Caddyfile:ro" -v "$T:/certs:ro" "$CADDY_IMAGE" >/dev/null
sleep 2
zap web https://app.acme.test:8443/
zap api-live http://127.0.0.1:4103/health/live
zap api-projects http://127.0.0.1:4103/v1/projects
node -e '
const fs=require("fs"),z=process.argv[1],out=[];
for (const n of ["web","api-live","api-projects"]) {
  let j; try{ j=JSON.parse(fs.readFileSync(`${z}/${n}.json`,"utf8")); }catch{ out.push({scan:n,missing:true}); continue; }
  for (const s of j.site) { const own = n==="web" ? s["@name"].startsWith("https://app.acme.test") : true;
    for (const a of s.alerts) out.push({scan:n,site:s["@name"],own,risk:a.riskdesc,name:a.name,count:a.count}); }
}
fs.writeFileSync(z+"/alerts-summary.json",JSON.stringify(out,null,1));' "$Z"
for n in web api-live api-projects; do
  miss=$(jq "[.[]|select(.scan==\"$n\" and .missing==true)]|length" "$Z/alerts-summary.json")
  hm=$(jq "[.[]|select(.scan==\"$n\" and .own==true and (.risk|test(\"^(High|Medium)\")))]|length" "$Z/alerts-summary.json")
  other=$(jq "[.[]|select(.scan==\"$n\" and .own==false and (.risk|test(\"^(High|Medium)\")))]|length" "$Z/alerts-summary.json")
  ac_check AC-40 "ZAP baseline $n: report produced" "$([ "$miss" = 0 ] && echo 1 || echo 0)"
  ac_check AC-40 "ZAP baseline $n: zero High and zero Medium alerts on the system under test (own site)" "$([ "$hm" = 0 ] && echo 1 || echo 0)" "own High/Medium: $hm; third-party IdP site High/Medium recorded separately: $other"
done
verdict_from AC-40 "deviations: openssl CA with SPKI pin instead of mkcert; ZAP verdict scoped to app.acme.test, Keycloak (id.acme.test) alerts recorded separately in AC-40/zap/alerts-summary.json"
exit 0
