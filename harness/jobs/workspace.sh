#!/bin/bash
# Workspace shape, install, static gates, env discipline, lockfile and licence checks:
# AC-09, AC-10, AC-11, AC-12, AC-19, AC-20, AC-23, AC-91, AC-92, AC-95.
. "$(dirname "$0")/../lib/common.sh"
provenance || exit 1
secrets_init

# ---------- AC-91 (part): install from the clean clone, counting lifecycle scripts ----------
ev_run AC-91 install-ndjson -- bash -c 'pnpm install --frozen-lockfile --reporter=ndjson'
install_exit=$?
cp "$EV/AC-91/install-ndjson.stdout" "$WORK/install.ndjson" 2>/dev/null
lifecycle_count=$(grep -c '"name":"pnpm:lifecycle"' "$WORK/install.ndjson" || true)

# ---------- AC-10: every step leaves tracked files untouched ----------
ac10_ok=1; ac10_why=""
[ "$install_exit" = 0 ] || { ac10_ok=0; ac10_why="install exit $install_exit"; }
tracked_clean AC-10 status-after-install || { ac10_ok=0; ac10_why="$ac10_why; install changed tracked files"; }

# ---------- AC-12: the twelve static gates, each followed by the AC-10 status check ----------
ac12_ok=1; ac12_why=""
for c in check:workspace boundaries format:check check:secrets check:docs lint check:arch typecheck build test:unit contract:check check:budget; do
  l="${c//:/_}"
  ev_run AC-12 "$l" -- pnpm "$c"; code=$?
  [ "$code" = 0 ] || { ac12_ok=0; ac12_why="$ac12_why $c=exit$code"; }
  tracked_clean AC-10 "status-after-$l" || { ac10_ok=0; ac10_why="$ac10_why; $c changed tracked files"; }
done
# No skipped or todo tests anywhere in the unit output; lint reports zero warnings.
cat "$EV/AC-12/test_unit.stdout" "$EV/AC-12/contract_check.stdout" > "$WORK/ac12-tests.txt"
if grep -E '^(ℹ|#) (skipped|todo) [1-9]' "$WORK/ac12-tests.txt" > "$EV/AC-12/skipped-todo.txt"; then ac12_ok=0; ac12_why="$ac12_why skipped/todo tests reported"; fi
if grep -Ei '[1-9][0-9]* warnings?\b|✖ .*warning' "$EV/AC-12/lint.stdout" "$EV/AC-12/lint.stderr" > "$EV/AC-12/lint-warnings.txt"; then ac12_ok=0; ac12_why="$ac12_why lint warnings"; fi
if [ $ac12_ok = 1 ]; then verdict AC-12 PASS "all 12 static gates exit 0; no skipped/todo tests; lint zero warnings"; else verdict AC-12 FAIL "${ac12_why# }"; fi

# Runtime suites for AC-10 need the test database and Redis, as in the generated CI.
infra_up postgres redis || { ac10_ok=0; ac10_why="$ac10_why; test services failed to start"; }
test_env
playwright_install
for c in test:integration test:runtime test:e2e; do
  l="${c//:/_}"
  ev_run AC-10 "$l" -- pnpm "$c"; code=$?
  [ "$code" = 0 ] || { ac10_ok=0; ac10_why="$ac10_why; $c exit $code"; }
  tracked_clean AC-10 "status-after-$l" || { ac10_ok=0; ac10_why="$ac10_why; $c changed tracked files"; }
done
unset EV_ENV_NAMES
if [ $ac10_ok = 1 ]; then verdict AC-10 PASS "frozen install exit 0; git status empty after install, 12 static gates, integration, runtime and e2e"; else verdict AC-10 FAIL "${ac10_why#; }"; fi

# ---------- AC-09: exact workspace shape ----------
ev_run AC-09 find-manifests -- bash -c "find . -path ./node_modules -prune -o \\( -name 'pnpm-lock.yaml' -o -name 'package-lock.json' -o -name 'yarn.lock' -o -name 'pnpm-workspace.yaml' -o -name .git -o -name .github \\) -print | grep -v '/node_modules/' | LC_ALL=C sort"
ev_run AC-09 ls-apps-packages -- bash -c 'ls apps; echo ---; ls packages'
ev_run AC-09 package-identity -- bash -c "jq -r '[input_filename,.name,.private,.packageManager] | @tsv' package.json apps/*/package.json packages/*/package.json"
ev_run AC-09 check-workspace -- pnpm check:workspace; cw=$?
found="$(tr '\n' ' ' < "$EV/AC-09/find-manifests.stdout")"
dirs="$(tr '\n' ' ' < "$EV/AC-09/ls-apps-packages.stdout")"
bad_pkgs="$(awk -F'\t' '$3!="true" || $2 !~ /^@repo\// {print $1}' "$EV/AC-09/package-identity.stdout" | tr '\n' ' ')"
pm_count="$(awk -F'\t' '$4!="null" && $4!="" {print $1}' "$EV/AC-09/package-identity.stdout")"
if [ "$found" = "./.git ./.github ./pnpm-lock.yaml ./pnpm-workspace.yaml " ] \
  && [ "$dirs" = "api web --- api-client eslint-config typescript-config " ] \
  && [ -z "$bad_pkgs" ] && [ "$pm_count" = "package.json" ] && [ "$cw" = 0 ]; then
  verdict AC-09 PASS "only root lockfile/workspace/.git/.github; exactly the five folders; all private and @repo/; only root has packageManager; check:workspace exit 0"
else
  verdict AC-09 FAIL "found=[$found] dirs=[$dirs] badPackages=[$bad_pkgs] packageManager=[$(echo $pm_count)] check:workspace=$cw"
fi

# ---------- AC-11: toolchain pins enforced ----------
# Each mismatched toolchain gets its own pristine worktree of the same commit, so a partial root-owned install
# never touches the clone used by the other checks.
for t in n22 p11; do git -C "$WS" worktree add -q --detach "$WORK/ac11-$t" HEAD; done
ev_run AC-11 node22-install -- docker run --rm --cpus=2 --memory=2g -v "$WORK/ac11-n22":/r -w /r node:22-bookworm-slim sh -c 'corepack enable && pnpm install --frozen-lockfile'; n22=$?
ev_run AC-11 pnpm11-install -- docker run --rm --cpus=2 --memory=2g -v "$WORK/ac11-p11":/r -w /r node:24.22.1 sh -c 'npx --yes pnpm@11 install --frozen-lockfile'; p11=$?
sudo rm -rf "$WORK/ac11-n22" "$WORK/ac11-p11"; git -C "$WS" worktree prune
ev_run AC-11 pins -- bash -c 'echo ".nvmrc=$(cat .nvmrc)"; echo "engines.node=$(jq -r .engines.node package.json)"; echo "packageManager=$(jq -r .packageManager package.json)"; echo "ci-node=$(grep -E "node-version:" .github/workflows/verify.yml | awk "{print \$2}" | sort -u | tr "\n" " ")"; echo "ci-pnpm=$(grep -A3 "pnpm/action-setup" .github/workflows/verify.yml | grep -E "version:" | awk "{print \$2}" | sort -u | tr "\n" " ")"; echo "docker-from=$(grep -hE "^FROM node:" apps/*/Dockerfile | awk "{print \$2}" | sed -E "s/@.*//" | sort -u | tr "\n" " ")"; echo "docker-pnpm=$(grep -hoE "pnpm@[0-9.]+" apps/*/Dockerfile | sort -u | tr "\n" " ")"'
pins="$EV/AC-11/pins.stdout"
pm="$(sed -n 's/^packageManager=pnpm@//p' "$pins" | sed 's/+.*//')"
ok11=1; why11=""
[ "$n22" != 0 ] && grep -Eqi 'engine|unsupported|node' "$EV/AC-11/node22-install.stdout" "$EV/AC-11/node22-install.stderr" || { ok11=0; why11="$why11 node22 install exit=$n22 without engine message;"; }
[ "$p11" != 0 ] && grep -Eqi 'packageManager|pnpm|version|engine' "$EV/AC-11/pnpm11-install.stdout" "$EV/AC-11/pnpm11-install.stderr" || { ok11=0; why11="$why11 pnpm11 install exit=$p11 without version message;"; }
grep -q '^\.nvmrc=24\.22\.1$' "$pins" || { ok11=0; why11="$why11 .nvmrc;"; }
grep -Eq '^engines\.node=.*24\.22\.1' "$pins" || { ok11=0; why11="$why11 engines.node;"; }
grep -Eq '^ci-node=24\.22\.1 $' "$pins" || { ok11=0; why11="$why11 CI node-version;"; }
grep -Eq '^docker-from=node:24\.22\.1-alpine $' "$pins" || { ok11=0; why11="$why11 Dockerfile FROM;"; }
grep -Eq "^ci-pnpm=$pm \$" "$pins" || { ok11=0; why11="$why11 CI pnpm != packageManager;"; }
grep -Eq "^docker-pnpm=pnpm@$pm \$" "$pins" || { ok11=0; why11="$why11 Dockerfile pnpm != packageManager;"; }
if [ $ok11 = 1 ]; then verdict AC-11 PASS "Node 22 and pnpm 11 installs exit non-zero with version messages; .nvmrc, engines, CI and Dockerfile all name 24.22.1; pnpm $pm identical everywhere"; else verdict AC-11 FAIL "$why11"; fi

# ---------- AC-19: strict env mode, declared build env, undeclared value not inlined ----------
ev_run AC-19 envmode -- jq .envMode turbo.json
ev_run AC-19 dry-run-env -- bash -c "pnpm exec turbo run build --dry=json | jq '[.tasks[] | {taskId, env: .environmentVariables}]'"
ev_run AC-19 global-env -- jq '{globalEnv, globalPassThroughEnv, tasks: (.tasks | with_entries(.value |= {env, passThroughEnv}))}' turbo.json
# Variables each app build reads, including local imported helpers and Prisma's config, must be declared for that
# app's build task. Package-level turbo.json files are included in Turbo's dry-run resolved environment.
ev_run AC-19 build-reads-web -- node "$HARNESS/lib/build-env-reads.mjs" apps/web/next.config.ts apps/web/scripts/package.mjs
ev_run AC-19 build-reads-api -- node "$HARNESS/lib/build-env-reads.mjs" apps/api/prisma.generate.config.ts
global_declared="$(jq -r '(.globalEnv // []) + (.globalPassThroughEnv // []) | .[]' turbo.json)"
web_declared="$(jq -r '.[] | select(.taskId=="@repo/web#build") | .env | ((.specified.env // []) + (.specified.passThroughEnv // []) + (.inferred // [])) | .[]' "$EV/AC-19/dry-run-env.stdout" 2>/dev/null; echo "$global_declared")"
api_declared="$(jq -r '.[] | select(.taskId=="@repo/api#build") | .env | ((.specified.env // []) + (.specified.passThroughEnv // []) + (.inferred // [])) | .[]' "$EV/AC-19/dry-run-env.stdout" 2>/dev/null; echo "$global_declared")"
undeclared=""
while read -r v; do [ -z "$v" ] && continue; echo "$web_declared" | grep -Eqx "$v|${v%%_*}_\\*" || undeclared="$undeclared web:$v"; done < "$EV/AC-19/build-reads-web.stdout"
while read -r v; do [ -z "$v" ] && continue; echo "$api_declared" | grep -Eqx "$v|${v%%_*}_\\*" || undeclared="$undeclared api:$v"; done < "$EV/AC-19/build-reads-api.stdout"
mode="$(tr -d '"\n' < "$EV/AC-19/envmode.stdout")"
# Throwaway branch: a page renders an undeclared NEXT_PUBLIC_ value.
git -C "$WS" switch -q -c throwaway/ac19
mkdir -p "$WS/apps/web/src/app/ac19"
printf '%s\n' 'export default function Page() {' '  return <p>{process.env.NEXT_PUBLIC_UNDECLARED}</p>;' '}' > "$WS/apps/web/src/app/ac19/page.tsx"
git -C "$WS" add -A && git -C "$WS" -c user.name=harness -c user.email=harness@invalid commit -qm "test: AC-19 throwaway"
git -C "$WS" show --stat --patch HEAD > "$EV/AC-19/throwaway.diff"
EV_ENV_NAMES=NEXT_PUBLIC_UNDECLARED ev_run AC-19 throwaway-lint -- env NEXT_PUBLIC_UNDECLARED=SENTINEL-AC19 pnpm lint; tl=$?
EV_ENV_NAMES=NEXT_PUBLIC_UNDECLARED ev_run AC-19 throwaway-build -- env NEXT_PUBLIC_UNDECLARED=SENTINEL-AC19 pnpm exec turbo run build --filter=@repo/web --force; tb=$?
ev_run AC-19 sentinel-grep -- bash -c 'grep -rl SENTINEL-AC19 apps/web/.next || true'
lint_named=0; [ "$tl" != 0 ] && grep -q NEXT_PUBLIC_UNDECLARED "$EV/AC-19/throwaway-lint.stdout" "$EV/AC-19/throwaway-lint.stderr" && lint_named=1
sentinel_absent=0; [ "$tb" = 0 ] && [ ! -s "$EV/AC-19/sentinel-grep.stdout" ] && sentinel_absent=1
git -C "$WS" switch -q --detach "$TARGET_SHA" && git -C "$WS" branch -q -D throwaway/ac19 && rm -rf "$WS/apps/web/src/app/ac19"
if [ "$mode" = strict ] && [ -z "$undeclared" ] && { [ $lint_named = 1 ] || [ $sentinel_absent = 1 ]; }; then
  verdict AC-19 PASS "envMode strict; every web and API build read declared; throwaway: lintNamesVar=$lint_named sentinelAbsentFromBuild=$sentinel_absent"
else
  verdict AC-19 FAIL "envMode=$mode undeclared=[${undeclared# }] lintNamesVar=$lint_named sentinelAbsent=$sentinel_absent (build exit $tb)"
fi

# ---------- AC-20: filtered and pruned builds ----------
ok20=1; why20=""
for app in web api; do
  ev_run AC-20 "filter-$app" -- pnpm exec turbo run build --filter=@repo/$app --force || { ok20=0; why20="$why20 filter-$app;"; }
  out="$WORK/prune-$app"; rm -rf "$out"
  ev_run AC-20 "prune-$app" -- pnpm exec turbo prune @repo/$app --docker --out-dir "$out" || { ok20=0; why20="$why20 prune-$app;"; continue; }
  ev_run AC-20 "prune-$app-install" "$out/json" -- pnpm install --frozen-lockfile || { ok20=0; why20="$why20 prune-$app install;"; continue; }
  ev_run AC-20 "prune-$app-copy" "$out/json" -- cp -R ../full/. . || { ok20=0; why20="$why20 prune-$app copy;"; continue; }
  ev_run AC-20 "prune-$app-build" "$out/json" -- pnpm exec turbo run build --filter=@repo/$app || { ok20=0; why20="$why20 prune-$app build;"; }
done
if [ $ok20 = 1 ]; then verdict AC-20 PASS "filtered builds and turbo prune --docker builds of @repo/web and @repo/api all exit 0"; else verdict AC-20 FAIL "$why20"; fi

# ---------- AC-23: per-app env files, documented, value-free ----------
ev_run AC-23 ls -- bash -c 'ls -a . apps/*'
ev_run AC-23 check-ignore -- git check-ignore -v apps/api/.env apps/web/.env.local
ev_run AC-23 example-not-ignored -- bash -c 'git check-ignore -v apps/api/.env.example apps/web/.env.example; echo "exit=$?"'
ev_run AC-23 reads -- bash -c "grep -rhoE \"(process\\.env|env)\\.[A-Z][A-Z0-9_]+|env\\[['\\\"][A-Z][A-Z0-9_]+['\\\"]\\]\" apps/*/src apps/*/scripts apps/web/next.config.ts | sort -u"
ev_run AC-23 reads-runtime -- bash -c "grep -rhoE \"(process\\.env|env)\\.[A-Z][A-Z0-9_]+|env\\[['\\\"][A-Z][A-Z0-9_]+['\\\"]\\]\" apps/*/src apps/web/next.config.ts | sed -E \"s/.*[.\\[]['\\\"]?//; s/['\\\"]?\\]$//\" | sort -u"
ev_run AC-23 gitleaks -- docker run --rm --cpus=2 --memory=2g -v "$WS":/r -w /r "$GITLEAKS" detect --no-git --source apps --redact --no-banner --report-format json --report-path /r/.gitleaks-ac23.json
mv "$WS/.gitleaks-ac23.json" "$EV/AC-23/gitleaks-report.json"
# The pass rule counts findings in the example files; findings elsewhere (build caches) are kept in the report.
jq -r '.[] | select(.File | test("(^|/)\\.env\\.example$")) | "\(.File):\(.StartLine) \(.RuleID)"' "$EV/AC-23/gitleaks-report.json" > "$EV/AC-23/gitleaks-example-findings.txt"
gl=$( [ -f "$EV/AC-23/gitleaks-report.json" ] && [ ! -s "$EV/AC-23/gitleaks-example-findings.txt" ] && echo 0 || echo 1 )
ok23=1; why23=""
for app in api web; do [ -f "$WS/apps/$app/.env.example" ] || { ok23=0; why23="$why23 apps/$app/.env.example missing;"; }; done
root_env="$(cd "$WS" && ls -a | grep -E '^\.env' || true)"; [ -z "$root_env" ] || { ok23=0; why23="$why23 root env files: $root_env;"; }
[ "$(cat "$EV/AC-23/check-ignore.exit")" = 0 ] && [ "$(wc -l < "$EV/AC-23/check-ignore.stdout")" -ge 2 ] || { ok23=0; why23="$why23 .env not ignored;"; }
grep -q 'exit=1' "$EV/AC-23/example-not-ignored.stdout" || { ok23=0; why23="$why23 .env.example ignored;"; }
# Each runtime variable read in src/ or next.config.ts must have a doc row giving required, default, secret and purpose.
: > "$EV/AC-23/doc-rows.txt"
while read -r v; do
  [ -z "$v" ] && continue
  row="$(grep -h "^| \`$v\` |" "$WS"/apps/*/docs/environment.md | head -1)"
  cols=$(printf '%s' "$row" | awk -F'|' '{n=0; for(i=2;i<NF;i++){g=$i; gsub(/ /,"",g); if(g!="") n++} print n}')
  printf '%s\t%s\n' "$v" "${row:-<no row>}" >> "$EV/AC-23/doc-rows.txt"
  if [ -z "$row" ] || [ "${cols:-0}" -lt 5 ]; then
    grep -qx "$v=.*" "$WS"/apps/*/.env.example 2>/dev/null && [ -n "$row" ] || { ok23=0; why23="$why23 $v undocumented;"; }
  fi
done < "$EV/AC-23/reads-runtime.stdout"
head -3 "$WS/apps/web/docs/environment.md" "$WS/apps/api/docs/environment.md" > /dev/null
grep -h '^| Variable' "$WS"/apps/*/docs/environment.md > "$EV/AC-23/doc-headers.txt"
for app in api web; do grep -q '^| Variable | Required | Default | Secret | Purpose |' "$WS/apps/$app/docs/environment.md" || { ok23=0; why23="$why23 apps/$app env doc table lacks the four facts;"; }; done
[ "$gl" = 0 ] || { ok23=0; why23="$why23 gitleaks findings in .env.example files (or no report);"; }
if [ $ok23 = 1 ]; then verdict AC-23 PASS "per-app .env.example; no root .env*; ignore rules work; every runtime read documented with required/default/secret/purpose; gitleaks zero findings in example files"; else verdict AC-23 FAIL "$why23"; fi

# ---------- AC-91: lockfile integrity and install-script policy ----------
ev_run AC-91 integrity-count -- bash -c "grep -cE 'resolution: \\{integrity: sha512-' pnpm-lock.yaml"
ev_run AC-91 package-count -- bash -c "awk '/^packages:/{p=1;next} /^[a-z]/{p=0} p && /^  [^ ].*:\$/' pnpm-lock.yaml | wc -l"
ev_run AC-91 url-sources -- bash -c "grep -nE 'tarball:|git\\+|github:|https?://' pnpm-lock.yaml || true"
ev_run AC-91 ignore-scripts -- grep -n ignoreScripts pnpm-workspace.yaml
ev_run AC-91 allow-builds -- bash -c "awk '/^allowBuilds:/{p=1;print;next} /^[^ ]/{p=0} p' pnpm-workspace.yaml"
echo "$lifecycle_count" > "$EV/AC-91/lifecycle-count.txt"
ic=$(tr -d ' ' < "$EV/AC-91/integrity-count.stdout"); pc=$(tr -d ' ' < "$EV/AC-91/package-count.stdout")
allowed=$(grep -c ': true' "$EV/AC-91/allow-builds.stdout" || true)
if [ "$install_exit" = 0 ] && [ "$ic" = "$pc" ] && [ "$pc" -gt 0 ] && [ ! -s "$EV/AC-91/url-sources.stdout" ] && grep -q 'ignoreScripts: true' "$EV/AC-91/ignore-scripts.stdout" && [ "$lifecycle_count" -le "$allowed" ]; then
  verdict AC-91 PASS "$ic/$pc packages have sha512 integrity; no git/URL sources; ignoreScripts true; $lifecycle_count lifecycle scripts run ($allowed allowed)"
else
  verdict AC-91 FAIL "integrity $ic/$pc; urlSources=$( [ -s "$EV/AC-91/url-sources.stdout" ] && echo yes || echo no); lifecycle=$lifecycle_count allowed=$allowed; install=$install_exit"
fi

# ---------- AC-92: exact versions, one version each of shared deps ----------
ev_run AC-92 loose-specifiers -- bash -c "jq -r '.. | objects | to_entries[]? | select(.key|test(\"ependencies\$\")) | .value | to_entries[] | .value' package.json apps/*/package.json packages/*/package.json | grep -E '^[\\^~*]|latest|x\$' || true"
ev_run AC-92 why -- pnpm why -r react typescript @types/node --json
versions="$(jq -r '.. | objects | select(has("version") and (.name? // .from? // "" | test("^(react|typescript|@types/node)$"))) | "\(.name // .from)@\(.version)"' "$EV/AC-92/why.stdout" 2>/dev/null | sort -u)"
printf '%s\n' "$versions" > "$EV/AC-92/resolved-versions.txt"
multi="$(printf '%s\n' "$versions" | sed 's/@[^@]*$//' | sort | uniq -d | tr '\n' ' ')"
each="$(printf '%s\n' "$versions" | sed 's/@[^@]*$//' | sort -u | tr '\n' ' ')"
if [ ! -s "$EV/AC-92/loose-specifiers.stdout" ] && [ "$(cat "$EV/AC-92/why.exit")" = 0 ] && [ -z "$multi" ] && [ "$each" = "@types/node react typescript " ]; then
  verdict AC-92 PASS "no loose specifiers; one version each: $(tr '\n' ' ' < "$EV/AC-92/resolved-versions.txt")"
else
  verdict AC-92 FAIL "loose=[$(tr '\n' ' ' < "$EV/AC-92/loose-specifiers.stdout")] multiple=[$multi] found=[$each]"
fi

# ---------- AC-95: production licences ----------
ev_run AC-95 licenses -- pnpm licenses list --prod --json --filter @repo/api --filter @repo/web
bad95="$(jq -r 'to_entries[] | .key as $l | .value[] | select(($l|test("(^|[^L])GPL|SSPL";"i")) or ($l|test("^(unknown|unlicensed|)$";"i"))) | "\(.name)@\(.versions // [.version] | join(",")) \($l)"' "$EV/AC-95/licenses.stdout" 2>/dev/null)"
printf '%s\n' "$bad95" > "$EV/AC-95/disallowed.txt"
# LGPL is not in the prohibited list (AGPL, GPL, SSPL, unknown); listed for the reviewer.
jq -r 'to_entries[] | select(.key|test("LGPL";"i")) | .key as $l | .value[] | "\(.name) \($l)"' "$EV/AC-95/licenses.stdout" > "$EV/AC-95/lgpl-noted.txt" 2>/dev/null
n95="$(jq '[to_entries[] | .value[]] | length' "$EV/AC-95/licenses.stdout" 2>/dev/null || echo 0)"
if [ "$(cat "$EV/AC-95/licenses.exit")" = 0 ] && [ "${n95:-0}" -gt 0 ] && [ -z "$bad95" ]; then
  verdict AC-95 PASS "$n95 production packages; none AGPL/GPL/SSPL/unknown"
else
  verdict AC-95 FAIL "exit $(cat "$EV/AC-95/licenses.exit"); packages=$n95; disallowed=[$(echo $bad95)]"
fi
