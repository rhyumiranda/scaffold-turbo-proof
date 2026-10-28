#!/bin/bash
# API contract, fuzzing, dependency and static analysis: AC-27, AC-29, AC-30, AC-44, AC-45.
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/contract.sh"
provenance || exit 1
secrets_init
TO="timeout 1500"
ALL="AC-27 AC-29 AC-30 AC-44 AC-45"

# ---------- AC-44 and AC-45 need no build: run them on tracked files only ----------
# ---------- AC-44: no known high or critical vulnerabilities ----------
mkdir -p "$EV/AC-44"
ev_run AC-44 pnpm-audit -- pnpm audit --audit-level=high; pa=$?
ev_run AC-44 pnpm-audit-json -- pnpm audit --json
ev_run AC-44 osv-scan -- docker run --rm --cpus=2 --memory=2g -v "$WS":/r:ro "$OSV_IMAGE" scan source --lockfile /r/pnpm-lock.yaml; oa=$?
ev_run AC-44 osv-json -- docker run --rm --cpus=2 --memory=2g -v "$WS":/r:ro "$OSV_IMAGE" scan source --lockfile /r/pnpm-lock.yaml --format json; oj=$?
hc="$(jq -r '[.results[]?.packages[]? | ((.groups[]? | select(((.max_severity // "0") | tonumber? // 0) >= 7) | .ids[]), (.vulnerabilities[]? | select(((.database_specific.severity // "") | ascii_upcase) as $s | $s == "HIGH" or $s == "CRITICAL") | .id))] | unique | .[]' "$EV/AC-44/osv-json.stdout" 2>/dev/null)"
printf '%s\n' "$hc" > "$EV/AC-44/osv-high-critical-ids.txt"
audit_ids="$( { grep -ohE 'GHSA-[a-z0-9-]+|CVE-[0-9]+-[0-9]+' "$EV/AC-44/pnpm-audit.stdout" "$EV/AC-44/pnpm-audit-json.stdout" 2>/dev/null; } | sort -u)"
today="$(date -u +%F)"
covered() { # ID  -> 0 when a tracked exception file names it with an expiry date not in the past
  local id="$1" f
  for f in $(git -C "$WS" ls-files | grep -iE 'exception|osv-scanner\.toml|audit-ci'); do
    grep -q "$id" "$WS/$f" && grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' "$WS/$f" | awk -v t="$today" '$1 >= t {ok=1} END{exit !ok}' && return 0
  done
  return 1
}
unc=""
if [ "$pa" != 0 ]; then for id in $audit_ids; do covered "$id" || unc="$unc $id"; done; [ -n "$audit_ids" ] || unc="$unc (audit failed without advisory ids)"; fi
if [ "$oa" != 0 ]; then
  [ "$oj" = 0 ] || [ "$oj" = 1 ] || unc="$unc (osv exit $oj)"
  for id in $hc; do covered "$id" || unc="$unc $id"; done
fi
if [ -z "$unc" ]; then verdict AC-44 PASS "pnpm audit exit $pa; osv-scanner exit $oa (high/critical ids: $(echo $hc | wc -w)); no uncovered High/Critical advisory"; else verdict AC-44 FAIL "uncovered:$unc (pnpm audit exit $pa, osv exit $oa)"; fi

# ---------- AC-45: static analysis ----------
mkdir -p "$EV/AC-45" "$WORK/ac45-out"; rm -rf "$WORK/ac45-src"; mkdir -p "$WORK/ac45-src"; chmod 777 "$WORK/ac45-out"
git -C "$WS" archive HEAD | tar -x -C "$WORK/ac45-src"     # tracked source only: no node_modules, no build output
ev_run AC-45 semgrep -- docker run --rm --cpus=2 --memory=2g -v "$WORK/ac45-src":/src -v "$WORK/ac45-out":/out "$SEMGREP_IMAGE" semgrep scan --config p/owasp-top-ten --config p/typescript --config p/nodejsscan --config p/secrets --severity ERROR --error --exclude '**/test/**' --exclude '**/tests/**' --json --output /out/semgrep.json /src; sg=$?
cp "$WORK/ac45-out/semgrep.json" "$EV/AC-45/semgrep.json" 2>/dev/null
ev_run AC-45 fp-route -- grep -n "identity.begin(request.nextUrl.searchParams.get('returnTo')" "apps/web/src/app/auth/[operation]/route.ts"; r1=$?
ev_run AC-45 fp-identity -- grep -nE "safeReturnTo|buildAuthorizationUrl" apps/web/src/lib/identity.ts; r2=$?
scanned="$(jq '.paths.scanned | length' "$EV/AC-45/semgrep.json" 2>/dev/null || echo 0)"
nfind="$(jq '.results | length' "$EV/AC-45/semgrep.json" 2>/dev/null || echo -1)"
unexpected="$(jq '[.results[] | select(((.check_id | endswith("express_open_redirect")) and (.path | endswith("apps/web/src/app/auth/[operation]/route.ts"))) | not)] | length' "$EV/AC-45/semgrep.json" 2>/dev/null || echo -1)"
{ echo "False positive: njsscan express_open_redirect at apps/web/src/app/auth/[operation]/route.ts."
  echo "Reason: the redirect target is oidc.buildAuthorizationUrl() built from the configured issuer; the request's returnTo is only stored server-side after safeReturnTo() (same-origin path only) and never enters that URL."; } > "$EV/AC-45/false-positive-reason.txt"
fpok=0; [ $r1 = 0 ] && [ $r2 = 0 ] && [ "$(grep -c 'safeReturnTo' "$EV/AC-45/fp-identity.stdout")" -ge 3 ] && grep -q buildAuthorizationUrl "$EV/AC-45/fp-identity.stdout" && fpok=1
if [ "${scanned:-0}" -gt 50 ] && { [ $sg = 0 ] || { [ $sg = 1 ] && [ "$unexpected" = 0 ] && [ $fpok = 1 ]; }; }; then
  verdict AC-45 PASS "semgrep exit $sg over $scanned files; $nfind ERROR finding(s), all the documented njsscan open-redirect false positive (returnTo sanitised by safeReturnTo, URL built by buildAuthorizationUrl)"
else
  verdict AC-45 FAIL "semgrep exit $sg scanned=$scanned findings=$nfind unexpected=$unexpected falsePositiveEvidence=$fpok"
fi

ws_install || { for a in AC-27 AC-29 AC-30; do verdict $a FAIL "pnpm install --frozen-lockfile failed"; done; exit 0; }
ws_build || { for a in AC-27 AC-29 AC-30; do verdict $a FAIL "pnpm build failed"; done; exit 0; }

# ---------- AC-27: checked-in schema equals a fresh export ----------
mkdir -p "$EV/AC-27"
ev_run AC-27 export -- pnpm --filter @repo/api contract; e1=$?
ev_run AC-27 diff-api -- git diff --exit-code -- apps/api/openapi.json; e2=$?
ev_run AC-27 contract-check -- pnpm contract:check; e3=$?
ev_run AC-27 client-copy -- cmp apps/api/openapi.json packages/api-client/contract/openapi.json; e4=$?
# The repo's own pinned generator (openapi-typescript 7.13.0, a devDependency of @repo/api-client); `npx` is refused by the repo's devEngines.
ev_run AC-27 fresh-types -- pnpm --filter @repo/api-client exec openapi-typescript contract/openapi.json -o "$WORK/ac27-fresh.d.ts"; e5=$?
ev_run AC-27 types-diff -- diff "$WORK/ac27-fresh.d.ts" packages/api-client/src/api.d.ts; e6=$?
ev_run AC-27 paths -- jq -r '.paths | keys[]' apps/api/openapi.json
paths_ok=0; jq -e '(([.paths|keys[]|select(startswith("/health")|not)|select(startswith("/v1/")|not)]|length)==0) and (([.paths|keys[]|select(startswith("/health"))]|length)>0) and (([.paths|keys[]|select(startswith("/v1/"))]|length)>0)' "$WS/apps/api/openapi.json" >/dev/null 2>&1 && paths_ok=1
tracked_clean AC-27 status; e7=$?
if [ $e1 = 0 ] && [ $e2 = 0 ] && [ $e3 = 0 ] && [ $e4 = 0 ] && [ $e5 = 0 ] && [ $e6 = 0 ] && [ $paths_ok = 1 ] && [ $e7 = 0 ]; then
  verdict AC-27 PASS "fresh export equals apps/api/openapi.json; client copy identical; fresh openapi-typescript output equals api.d.ts; contract:check exit 0; resources /v1, health unversioned"
else
  verdict AC-27 FAIL "export=$e1 gitDiff=$e2 contractCheck=$e3 copyCmp=$e4 genTypes=$e5 typesDiff=$e6 pathsVersioned=$paths_ok trackedClean=$e7"
fi

# ---------- AC-29: breaking changes are detected ----------
mkdir -p "$EV/AC-29"; : > "$EV/AC-29/summary.txt"; ok29=1; why29=""
ac29_case() { # label, breaking (1) or additive (0)
  local label="$1" breaking="$2" g c o
  if git -C "$WS" diff --quiet; then ok29=0; why29="$why29 ($label) edit changed nothing;"; return; fi
  fixture_diff AC-29 "$label"
  ev_run AC-29 "$label-generate" -- $TO pnpm contract:generate; g=$?
  ev_run AC-29 "$label-check" -- $TO pnpm contract:check; c=$?
  ev_run AC-29 "$label-oasdiff" -- docker run --rm --cpus=2 --memory=2g -v "$WS":/s:ro "$OASDIFF_IMAGE" breaking /s/packages/api-client/contract/accepted.openapi.json /s/apps/api/openapi.json --fail-on ERR; o=$?
  echo "$label breaking=$breaking generate=$g contract:check=$c oasdiff=$o" >> "$EV/AC-29/summary.txt"
  [ $g = 0 ] || { ok29=0; why29="$why29 ($label) contract:generate exit $g;"; return; }
  if [ "$breaking" = 1 ]; then
    [ $c != 0 ] || { ok29=0; why29="$why29 ($label) contract:check passed;"; }
    [ $o != 0 ] || { ok29=0; why29="$why29 ($label) oasdiff sees no break;"; }
  else
    [ $c = 0 ] || { ok29=0; why29="$why29 ($label) additive change fails contract:check;"; }
    [ $o = 0 ] || { ok29=0; why29="$why29 ($label) oasdiff flags additive change;"; }
  fi
}
D=apps/api/src/projects
neg_start AC-29 a-remove-response-prop
sed -i '/createdAt!: string;/d' "$WS/$D/dto.ts"; sed -i 's/, createdAt: row.created_at.toISOString() }/ }/' "$WS/$D/service.ts"
ac29_case a-remove-response-prop 1
neg_start AC-29 b-optional-to-required
sed -i 's/required: false, default: 25/required: true, default: 25/' "$WS/$D/dto.ts"
ac29_case b-optional-to-required 1
neg_start AC-29 c-remove-operation
sed -i "/^  @Patch/,/^  }\$/d" "$WS/$D/controller.ts"
ac29_case c-remove-operation 1
neg_start AC-29 d-narrow-maxlength
sed -i 's/maxLength: 100/maxLength: 50/; s/@Length(1, 100)/@Length(1, 50)/' "$WS/$D/dto.ts"
ac29_case d-narrow-maxlength 1
neg_start AC-29 e-additive-optional-response
sed -i '/createdAt!: string;/a\  @ApiProperty({ required: false }) note?: string;' "$WS/$D/dto.ts"
ac29_case e-additive-optional-response 0
restore_main
ev_run _setup-contract rebuild-pristine -- pnpm build
if [ $ok29 = 1 ]; then verdict AC-29 PASS "contract:check fails after regeneration for removed response property, optional->required, removed operation, narrowed maxLength; oasdiff reports each as breaking; additive optional response field passes both ($(tr '\n' ';' < "$EV/AC-29/summary.txt"))"; else verdict AC-29 FAIL "$why29"; fi

# ---------- AC-30: fuzzing the running API ----------
mkdir -p "$EV/AC-30/report"; chmod 777 "$EV/AC-30/report"
infra_up postgres keycloak; i30=$?
test_env
EV_ENV_NAMES="NODE_ENV DATABASE_URL" ev_run AC-30 migrate -- pnpm --filter @repo/api migrate; m30=$?
EV_ENV_NAMES="KC_ACME_CLI_SECRET KC_USER_PASSWORD" ev_run AC-30 token -- bash "$HARNESS/infra/contract/get-token.sh" alice "$WORK/.alice-token"; t30=$?
ALICE="$(cat "$WORK/.alice-token" 2>/dev/null)"; echo "::add-mask::$ALICE"
export WS WORK
EV_ENV_NAMES="DATABASE_URL WS" ev_run AC-30 api-start -- bash "$HARNESS/infra/contract/start-api.sh" "$EV/AC-30"; a30=$?
export ALICE SCHEMA_FILE="$WS/apps/api/openapi.json" REPORT_DIR="$EV/AC-30/report" ST_IMAGE="$SCHEMATHESIS_IMAGE"
EV_ENV_NAMES="ALICE SCHEMA_FILE REPORT_DIR ST_IMAGE" ev_run AC-30 schemathesis -- timeout 1500 bash -c 'docker run --rm --name acc-fuzz --cpus=2 --memory=2g --network host -v "$SCHEMA_FILE":/schema/openapi.json:ro -v "$REPORT_DIR":/report "$ST_IMAGE" run /schema/openapi.json --url http://127.0.0.1:4100 --checks all -H "Authorization: Bearer $ALICE" --max-examples 200 --report junit,ndjson --report-dir /report'; st30=$?
docker rm -f acc-fuzz >/dev/null 2>&1
kill "$(cat "$EV/AC-30/api.pid" 2>/dev/null)" 2>/dev/null
sudo chown -R "$(id -u):$(id -g)" "$EV/AC-30/report" 2>/dev/null
# Remove the token from any evidence file.
grep -rlF "$ALICE" "$EV/AC-30" 2>/dev/null | while read -r f; do sed -i "s/$ALICE/<redacted-token>/g" "$f"; done
unset ALICE
nd="$(ls "$EV"/AC-30/report/ndjson-*.ndjson 2>/dev/null | head -1)"; ju="$(ls "$EV"/AC-30/report/junit-*.xml 2>/dev/null | head -1)"
listed='not_a_server_error|status_code_conformance|content_type_conformance|response_schema_conformance|response_headers_conformance'
if [ -n "$nd" ] && [ -n "$ju" ]; then
  jq -r '.. | objects | select(has("name") and has("status") and .status=="failure") | .name' "$nd" | sort | uniq -c > "$EV/AC-30/failed-checks.txt"
  jq -r '.. | objects | select(has("name") and has("status") and .status=="success") | .name' "$nd" | sort | uniq -c > "$EV/AC-30/passed-checks.txt"
  listed_fail="$(grep -cE " ($listed)\$" "$EV/AC-30/failed-checks.txt")"
  listed_pass="$(grep -cE " ($listed)\$" "$EV/AC-30/passed-checks.txt")"
  ops_missing=""
  while read -r m p; do grep -qF "testcase name=\"${m^^} $p\"" "$ju" || ops_missing="$ops_missing ${m^^} $p"; done < <(jq -r '.paths | to_entries[] | .key as $p | .value | keys[] | select(IN("get","post","put","patch","delete","head","options")) | "\(.) \($p)"' "$WS/apps/api/openapi.json")
else listed_fail=-1; listed_pass=0; ops_missing=" (no report)"; fi
jq -r 'select(.event=="request.complete") | .status' "$EV/AC-30/api.stdout" 2>/dev/null | sort | uniq -c > "$EV/AC-30/api-status-counts.txt"
n5xx="$(jq -r 'select(.event=="request.complete" and .status>=500) | .status' "$EV/AC-30/api.stdout" 2>/dev/null | wc -l)"
nreq="$(jq -r 'select(.event=="request.complete") | .status' "$EV/AC-30/api.stdout" 2>/dev/null | wc -l)"
infra_down
if [ $i30 = 0 ] && [ $m30 = 0 ] && [ $t30 = 0 ] && [ $a30 = 0 ] && [ "$listed_fail" = 0 ] && [ "$listed_pass" = 5 ] && [ -z "$ops_missing" ] && [ "$n5xx" = 0 ] && [ "$nreq" -gt 100 ]; then
  verdict AC-30 PASS "schemathesis (exit $st30) --checks all, max 200 examples, alice token: 0 failures in the 5 named checks (other failures: $(grep -vE " ($listed)\$" "$EV/AC-30/failed-checks.txt" | awk '{print $2}' | sort -u | tr '\n' ',' )); every operation tested; $nreq API requests, 0 responses >=500"
else
  verdict AC-30 FAIL "infra=$i30 migrate=$m30 token=$t30 api=$a30 schemathesisExit=$st30 listedCheckFailures=$listed_fail listedChecksSeen=$listed_pass opsMissing=[$ops_missing] 5xx=$n5xx requests=$nreq"
fi
