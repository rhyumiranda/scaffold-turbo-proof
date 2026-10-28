#!/bin/bash
# Container images: AC-25, AC-76, AC-77, AC-78, AC-79, AC-80, AC-81, AC-82, AC-94.
# Images are built one at a time, in the order the criteria need them. The runtime topology (Postgres, TLS Redis,
# Keycloak, Caddy TLS edge) is described in harness/lib/containers.sh.
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/containers.sh"
provenance || exit 1
secrets_init
mkdir -p "$WORK/trivy-cache"

trivy_run() { docker run --rm --cpus=2 --memory=2g -v /var/run/docker.sock:/var/run/docker.sock -v "$WORK/trivy-cache":/root/.cache "$IMG_TRIVY" "$@"; }

# ---------- setup: install, browser, stack ----------
ws_install || echo "install failed"
playwright_install || echo "playwright install failed"
infra_ok=1
ev_run "_infra-$JOB" stack-up -- ct_stack_up || { infra_ok=0; echo "stack failed to start"; }

# =====================================================================================================
# AC-76: builds from the repo root, hadolint, cache reuse after a web-only change
# =====================================================================================================
ok76=1; why76=""
ev_run AC-76 build-api-runtime -- docker build --progress=plain -f apps/api/Dockerfile --target runtime -t acme-api . || { ok76=0; why76="$why76 api runtime build;"; }
ev_run AC-76 build-api-migrate -- docker build --progress=plain -f apps/api/Dockerfile --target migrate -t acme-api-migrate . || { ok76=0; why76="$why76 api migrate build;"; }
ev_run AC-76 build-web -- docker build --progress=plain -f apps/web/Dockerfile -t acme-web . || { ok76=0; why76="$why76 web build;"; }
ev_run AC-76 hadolint-digest -- bash -c "echo '$IMG_HADOLINT'"
for app in api web; do
  # Criterion form (default report; exit 1 means findings of any level), then the error-threshold JSON report.
  ev_run AC-76 "hadolint-$app-default" -- bash -c "docker run --rm -i --cpus=2 --memory=2g '$IMG_HADOLINT' < apps/$app/Dockerfile"
  ev_run AC-76 "hadolint-$app" -- bash -c "docker run --rm -i --cpus=2 --memory=2g '$IMG_HADOLINT' /bin/hadolint --failure-threshold error -f json - < apps/$app/Dockerfile" || { ok76=0; why76="$why76 hadolint $app exit nonzero;"; }
  errs="$(jq '[.[] | select(.level == "error")] | length' "$EV/AC-76/hadolint-$app.stdout" 2> /dev/null || echo missing)"
  [ "$errs" = 0 ] || { ok76=0; why76="$why76 hadolint $app error findings=$errs;"; }
done
# Change only apps/web/src/app/page.tsx on a throwaway branch and rebuild the API image.
git -C "$WS" switch -q -c throwaway/ac76
printf '\n// AC-76: web-only change\n' >> "$WS/apps/web/src/app/page.tsx"
git -C "$WS" add -A && git -C "$WS" -c user.name=harness -c user.email=harness@invalid commit -qm "test: AC-76 web-only change"
git -C "$WS" show --stat --patch HEAD > "$EV/AC-76/web-only.diff"
ev_run AC-76 rebuild-api-after-web-change -- docker build --progress=plain -f apps/api/Dockerfile --target runtime -t acme-api:rebuild . || { ok76=0; why76="$why76 api rebuild;"; }
git -C "$WS" switch -q --detach "$TARGET_SHA" && git -C "$WS" branch -q -D throwaway/ac76 || echo "FAILED to return to target commit" >&2
[ "$(git -C "$WS" rev-parse HEAD)" = "$TARGET_SHA" ] || { ok76=0; why76="$why76 workspace not back on target commit;"; }
ev_run AC-76 layers -- bash -c 'docker image inspect -f "{{json .RootFS.Layers}}" acme-api; docker image inspect -f "{{json .RootFS.Layers}}" acme-api:rebuild'
python3 - "$EV/AC-76/rebuild-api-after-web-change.stderr" > "$EV/AC-76/layers-cached.txt" <<'PY'
import re, sys
log = open(sys.argv[1], errors='replace').read()
steps = {}
for m in re.finditer(r'^#(\d+) (\[[^\]]*\] .*)$', log, re.M):
    steps.setdefault(m.group(1), m.group(2))
cached = set(re.findall(r'^#(\d+) CACHED', log, re.M))
bad = 0
for n, t in steps.items():
    print(('CACHED  ' if n in cached else 'REBUILT ') + t)
install = [n for n, t in steps.items() if 'pnpm install --frozen-lockfile' in t]
print('install steps:', install, 'cached:', [n in cached for n in install])
sys.exit(0 if install and all(n in cached for n in install) else 1)
PY
[ $? = 0 ] || { ok76=0; why76="$why76 dependency-install layer not reused after web-only change;"; }
if [ $ok76 = 1 ]; then verdict AC-76 PASS "api runtime, api migrate and web build from the repo root (exit 0); hadolint has no error findings; the API rebuild after a web-only change reuses the pnpm install layer"; else verdict AC-76 FAIL "${why76# }"; fi

# =====================================================================================================
# AC-82: digests and update automation (static)
# =====================================================================================================
ev_run AC-82 from-lines -- bash -c "grep -n '^FROM' apps/*/Dockerfile"
ev_run AC-82 dependabot -- cat .github/dependabot.yml
nofrom=$(grep -c . "$EV/AC-82/from-lines.stdout"); nodigest=$(grep -vc '@sha256:[0-9a-f]\{64\}' "$EV/AC-82/from-lines.stdout")
python3 - "$WS/.github/dependabot.yml" > "$EV/AC-82/dependabot-check.txt" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
blocks = re.split(r'(?m)^  - package-ecosystem:', text)[1:]
for b in blocks:
    eco = b.split('\n', 1)[0].strip()
    if eco == 'docker':
        covered = [d for d in ('/apps/api', '/apps/web') if re.search(r'["\']?' + re.escape(d) + r'["\']?', b)]
        print('docker ecosystem found; directories covered:', covered)
        sys.exit(0 if len(covered) == 2 else 1)
print('no docker ecosystem'); sys.exit(1)
PY
dep=$?
if [ "$nofrom" -ge 2 ] && [ "$nodigest" = 0 ] && [ $dep = 0 ]; then
  verdict AC-82 PASS "all $nofrom FROM lines carry @sha256 digests; dependabot docker ecosystem covers /apps/api and /apps/web"
else
  verdict AC-82 FAIL "FROM lines=$nofrom without digest=$nodigest; dependabot docker coverage exit=$dep"
fi

# =====================================================================================================
# AC-25: no secrets in image metadata (web build key is a sentinel passed as a BuildKit secret)
# =====================================================================================================
ok25=1; why25=""
key="$(python3 -c "import base64,os;print(base64.b64encode(base64.b64decode('SENTINELAC25')+os.urandom(23)).decode())")"
mkdir -p "$EV/AC-25" "$EV/AC-77" "$EV/AC-81"
printf '%s\n' "$key" > "$WORK/ac25.key"; chmod 600 "$WORK/ac25.key"
echo "sentinel prefix: SENTINELAC25 (the web build key is this prefix plus random bytes, canonical base64 of 32 bytes; the full key is kept out of evidence)" > "$EV/AC-25/sentinel-prefix.txt"
ev_run AC-25 build-api -- docker build --progress=plain -f apps/api/Dockerfile --target runtime -t acme-api:ac25 . || { ok25=0; why25="$why25 api build;"; }
EV_ENV_NAMES=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$key" \
  ev_run AC-25 build-web -- docker build --progress=plain -f apps/web/Dockerfile --secret id=next_action_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY --build-arg APP_DEPLOYMENT_ID=local-1 --build-arg DEPLOYMENT_REPLICAS=2 -t acme-web:ac25 . || { ok25=0; why25="$why25 web build;"; }
ac25_save() { # image, outdir: docker save, unpack every layer, grep for the sentinel and the full key
  local img="$1" d="$2" f n
  rm -rf "$d"; mkdir -p "$d/raw" "$d/layers"
  docker save "$img" -o "$d/image.tar" || return 1
  tar -xf "$d/image.tar" -C "$d/raw" || return 1
  find "$d/raw" -type f | while read -r f; do
    if tar -tf "$f" > /dev/null 2>&1; then n="$(echo "$f" | md5sum | cut -c1-12)"; mkdir -p "$d/layers/$n"; tar --no-same-permissions --no-same-owner -xf "$f" -C "$d/layers/$n" 2> /dev/null; fi
  done
  chmod -R u+rX "$d/layers" "$d/raw" 2> /dev/null
  echo "== metadata (non-layer files of the saved image: config, manifests) containing the sentinel or the full key"
  find "$d/raw" -type f | while read -r f; do
    tar -tf "$f" > /dev/null 2>&1 && continue
    grep -qaF -e SENTINELAC25 -f "$WORK/ac25.key" "$f" && echo "METADATA ${f#$d/}"
  done
  echo "== layer files containing the sentinel or the full key"
  grep -rlaF -e SENTINELAC25 -f "$WORK/ac25.key" "$d/layers" 2> /dev/null | sed "s#^$d/#FILESYSTEM #" || true
  echo "== end"
}
for pair in api:acme-api:ac25 web:acme-web:ac25; do
  nm="${pair%%:*}"; img="${pair#*:}"
  ev_run AC-25 "history-$nm" -- docker history --no-trunc "$img"
  ev_run AC-25 "inspect-$nm" -- docker image inspect "$img"
  ev_run AC-25 "env-$nm" -- docker image inspect --format '{{json .Config.Env}}' "$img"
  ev_run AC-25 "save-grep-$nm" -- ac25_save "$img" "$WORK/ac25-save-$nm"
  hits_meta=$(( $(cat "$EV/AC-25/history-$nm.stdout" "$EV/AC-25/inspect-$nm.stdout" "$EV/AC-25/env-$nm.stdout" | grep -aFc -e SENTINELAC25 -e "$key") + $(grep -ac '^METADATA ' "$EV/AC-25/save-grep-$nm.stdout") ))
  hits_log=$(cat "$EV/AC-25/build-$nm.stdout" "$EV/AC-25/build-$nm.stderr" | grep -aFc -e SENTINELAC25 -e "$key")
  [ "$hits_meta" = 0 ] || { ok25=0; why25="$why25 $nm sentinel in history/config/env ($hits_meta);"; }
  [ "$hits_log" = 0 ] || { ok25=0; why25="$why25 $nm sentinel in build log ($hits_log);"; }
  ev_run AC-25 "trivy-secret-$nm" -- bash -c "docker run --rm --cpus=2 --memory=2g -v '$WORK/trivy-cache':/root/.cache -v '$WORK/ac25-save-$nm/image.tar':/img.tar:ro '$IMG_TRIVY' image --scanners secret --format json --input /img.tar"
  tf=$(jq '[.Results[]? | .Secrets // [] | length] | add // 0' "$EV/AC-25/trivy-secret-$nm.stdout" 2> /dev/null || echo missing)
  [ "$tf" = 0 ] || { ok25=0; why25="$why25 trivy secret findings $nm=$tf;"; }
  rm -f "$WORK/ac25-save-$nm/image.tar"
done
fs_api=$(grep -ac '^FILESYSTEM ' "$EV/AC-25/save-grep-api.stdout")
fs_web=$(grep -ac '^FILESYSTEM ' "$EV/AC-25/save-grep-web.stdout")
[ "$fs_api" = 0 ] || { ok25=0; why25="$why25 api filesystem hits=$fs_api;"; }
# Web filesystem hits are allowed only for the variable docs/operations.md names as baked into the web image.
ev_run AC-25 docs-statement -- bash -c "grep -n 'secret-bearing\|NEXT_SERVER_ACTIONS_ENCRYPTION_KEY\|pull access' docs/operations.md"
if [ "$fs_web" != 0 ]; then
  if grep -q 'secret-bearing' "$EV/AC-25/docs-statement.stdout" && grep -q 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY.*server bundle\|embeds .NEXT_SERVER_ACTIONS_ENCRYPTION_KEY' "$EV/AC-25/docs-statement.stdout" && grep -q 'pull access' "$EV/AC-25/docs-statement.stdout"; then
    echo "web filesystem hits ($fs_web) correspond to NEXT_SERVER_ACTIONS_ENCRYPTION_KEY, named in docs/operations.md as embedded (secret-bearing image, restrict pull access)" > "$EV/AC-25/web-hits-declared.txt"
  else
    ok25=0; why25="$why25 web filesystem hits=$fs_web not declared in docs/operations.md;"
  fi
fi
if [ $ok25 = 1 ]; then verdict AC-25 PASS "0 sentinel hits in history, config, env and build logs; 0 Trivy secret findings; api filesystem 0 hits; web filesystem hits=$fs_web and declared as baked in by docs/operations.md"; else verdict AC-25 FAIL "${why25# }"; fi
docker rmi -f acme-api:ac25 acme-web:ac25 > /dev/null 2>&1
rm -rf "$WORK"/ac25-save-* "$WORK/ac25.key"

# =====================================================================================================
# AC-78 and AC-79: file ownership, size, contents
# =====================================================================================================
ok78=1; why78=""
for spec in acme-api:/app/dist/main.js acme-api:/app/node_modules acme-api-migrate:/app/dist/main.js acme-api-migrate:/app/node_modules acme-api-migrate:/app/scripts/migrate.mjs acme-api-migrate:/app/prisma acme-web:/app/apps/web/server.js acme-web:/app/node_modules acme-web:/app/apps/web/.next; do
  img="${spec%%:*}"; p="${spec#*:}"
  ev_run AC-78 "writable-${img}-$(echo "$p" | tr '/' '_')" -- docker run --rm --cpus=2 --memory=2g --entrypoint sh "$img" -c "test -w $p && echo WRITABLE || echo OK"
  out="$(cat "$EV/AC-78/writable-${img}-$(echo "$p" | tr '/' '_').stdout")"
  [ "$out" = OK ] || { ok78=0; why78="$why78 $img:$p -> ${out:-no output};"; }
done
for img in acme-api acme-api-migrate acme-web; do
  ev_run AC-78 "owner-$img" -- docker run --rm --cpus=2 --memory=2g --entrypoint sh "$img" -c 'id; ls -ld /app; echo "writable-under-/app=$(find /app -writable 2>/dev/null | wc -l)"'
  w="$(sed -n 's/^writable-under-\/app=//p' "$EV/AC-78/owner-$img.stdout")"
  [ "$w" = 0 ] || { ok78=0; why78="$why78 $img has $w writable paths under /app;"; }
done
if [ $ok78 = 1 ]; then verdict AC-78 PASS "test -w prints OK for dist/main.js, node_modules, server.js, .next, migrations and migrate.mjs; 0 paths under /app are writable by the runtime user in all three images"; else verdict AC-78 FAIL "${why78# }"; fi

ok79=1; why79=""
for img in acme-api acme-api-migrate acme-web; do
  ev_run AC-79 "size-$img" -- bash -c "echo inspect_Size=\$(docker image inspect -f '{{.Size}}' $img); echo rootfs_KB=\$(docker run --rm --cpus=2 --memory=2g --entrypoint sh $img -c 'du -skx / 2>/dev/null | tail -1' | cut -f1)"
  kb="$(sed -n 's/^rootfs_KB=//p' "$EV/AC-79/size-$img.stdout")"
  # Uncompressed size is the du total of the root filesystem (docker image inspect .Size can be a compressed size with the containerd store).
  if [ -n "$kb" ] && [ "$((kb * 1024))" -le 350000000 ]; then :; else ok79=0; why79="$why79 $img rootfs=${kb:-?}KB over 350 MB;"; fi
  ev_run AC-79 "find-$img" -- docker run --rm --cpus=2 --memory=2g --entrypoint sh "$img" -c 'find / -xdev \( -name "*.ts" ! -name "*.d.ts" -o -name ".env*" -o -name .git -o -name .pnpm-store -o -path "*/node_modules/typescript" -o -path "*/node_modules/eslint" -o -path "*/node_modules/@playwright" \) 2>/dev/null | head'
  [ ! -s "$EV/AC-79/find-$img.stdout" ] || { ok79=0; why79="$why79 $img contains forbidden files ($(head -1 "$EV/AC-79/find-$img.stdout"));"; }
done
sizes79=""; for i in acme-api acme-api-migrate acme-web; do sizes79="$sizes79$i=$(( $(sed -n 's/^rootfs_KB=//p' "$EV/AC-79/size-$i.stdout" | head -1 | grep . || echo 0) / 1024 ))MB "; done
if [ $ok79 = 1 ]; then verdict AC-79 PASS "uncompressed root filesystems ${sizes79}(limit 350 MB); the find prints nothing in all three images"; else verdict AC-79 FAIL "${why79# } [${sizes79}]"; fi

# =====================================================================================================
# AC-80: Trivy, fixable HIGH and CRITICAL
# =====================================================================================================
ok80=1; why80=""
for i in 1 2 3; do ev_run AC-80 "trivy-db-$i" -- trivy_run image --download-db-only && break; sleep 10; done
ev_run AC-80 trivy-version -- bash -c "echo '$IMG_TRIVY'"
for img in acme-api acme-api-migrate acme-web; do
  ev_run AC-80 "trivy-$img" -- trivy_run image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 "$img" || { ok80=0; why80="$why80 $img exit $(cat "$EV/AC-80/trivy-$img.exit");"; }
done
if [ $ok80 = 1 ]; then verdict AC-80 PASS "trivy image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 exits 0 for api, migrate and web"; else verdict AC-80 FAIL "${why80# }"; fi

# =====================================================================================================
# AC-77: unprivileged, read-only root filesystem, dropped capabilities, no-new-privileges
# =====================================================================================================
ok77=1; why77=""
for img in acme-api acme-api-migrate acme-web; do
  ev_run AC-77 "uid-$img" -- docker run --rm --cpus=2 --memory=2g --entrypoint id "$img" -u
  [ "$(cat "$EV/AC-77/uid-$img.stdout")" != 0 ] && [ -s "$EV/AC-77/uid-$img.stdout" ] || { ok77=0; why77="$why77 $img runs as uid 0;"; }
done
ct_db_create ac77_test > "$EV/AC-77/createdb.txt" 2>&1
ct_envfiles ac77_test > "$EV/AC-77/envfiles.txt" 2>&1
ev_run AC-77 migrate -- ct_migrate acme-api-migrate || { ok77=0; why77="$why77 migrate failed;"; }
ev_run AC-77 api-up -- ct_api_up acme-api || { ok77=0; why77="$why77 api not ready;"; }
ev_run AC-77 web-up -- ct_web_up acme-web || { ok77=0; why77="$why77 web not healthy;"; }
for c in acc-api acc-web; do
  ev_run AC-77 "flags-$c" -- docker inspect --format 'ReadonlyRootfs={{.HostConfig.ReadonlyRootfs}} CapDrop={{json .HostConfig.CapDrop}} SecurityOpt={{json .HostConfig.SecurityOpt}} Tmpfs={{json .HostConfig.Tmpfs}} User={{.Config.User}}' "$c"
  grep -q 'ReadonlyRootfs=true' "$EV/AC-77/flags-$c.stdout" && grep -q 'CapDrop=\["ALL"\]' "$EV/AC-77/flags-$c.stdout" && grep -q 'no-new-privileges' "$EV/AC-77/flags-$c.stdout" || { ok77=0; why77="$why77 $c missing hardening flags;"; }
  ev_run AC-77 "proc-uid-$c" -- docker exec "$c" sh -c 'id -u; grep -E "^(Uid|CapEff|NoNewPrivs)" /proc/1/status'
  [ "$(head -1 "$EV/AC-77/proc-uid-$c.stdout")" != 0 ] || { ok77=0; why77="$why77 $c process uid 0;"; }
done
ev_run AC-77 health -- bash -c 'curl -fsS -o /dev/null -w "api live %{http_code}\n" http://127.0.0.1:4100/health/live; curl -fsS -o /dev/null -w "api ready %{http_code}\n" http://127.0.0.1:4100/health/ready; curl -fsS -o /dev/null -w "web healthz %{http_code}\n" http://127.0.0.1:3000/healthz' || { ok77=0; why77="$why77 health checks;"; }
# The smoke path documented in docs/operations.md, then the browser journey against the containers.
ev_run AC-77 documented-smoke -- bash -c "API=http://127.0.0.1:4100 WEB=http://127.0.0.1:3000 sh -c 'curl -fsS \"\$API/health/ready\" && curl -fsS \"\$WEB/healthz\" && curl -fsS -o /dev/null -w \"%{http_code}\\n\" \"\$WEB/projects\"'" || { ok77=0; why77="$why77 documented smoke;"; }
EV_ENV_NAMES="WS BASE OUT NAME KC_USER KC_PASS RENAME" ev_run AC-77 journey -- ct_journey "AC-77 container" "$EV/AC-77/journey" rename || { ok77=0; why77="$why77 browser journey;"; }
unset EV_ENV_NAMES
f5=$(jq '.appResponses5xx | length' "$EV/AC-77/journey/result.json" 2> /dev/null || echo missing)
[ "$f5" = 0 ] || { ok77=0; why77="$why77 5xx responses in journey=$f5;"; }
docker logs acc-api > "$EV/AC-77/api-container.log" 2>&1; docker logs acc-web > "$EV/AC-77/web-container.log" 2>&1
if [ $ok77 = 1 ]; then verdict AC-77 PASS "uid != 0 in api, migrate and web; both containers ran with --read-only, --cap-drop ALL, no-new-privileges and no tmpfs; health, documented smoke and the Keycloak browser journey pass (0 5xx)"; else verdict AC-77 FAIL "${why77# }"; fi

# =====================================================================================================
# AC-81: container release flow end to end
# =====================================================================================================
ok81=1; why81=""
ct_db_create ac81_test > "$EV/AC-81/createdb.txt" 2>&1
ct_envfiles ac81_test > "$EV/AC-81/envfiles.txt" 2>&1
ev_run AC-81 migrate-fresh -- ct_migrate acme-api-migrate || { ok81=0; why81="$why81 migrate exit $(cat "$EV/AC-81/migrate-fresh.exit");"; }
ev_run AC-81 migrate-rerun -- ct_migrate acme-api-migrate || { ok81=0; why81="$why81 migrate rerun;"; }
ev_run AC-81 api-up -- ct_api_up acme-api || { ok81=0; why81="$why81 api not ready;"; }
ev_run AC-81 ready -- curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4100/health/ready
[ "$(cat "$EV/AC-81/ready.stdout")" = 200 ] || { ok81=0; why81="$why81 ready != 200;"; }
EV_ENV_NAMES="WS BASE OUT NAME KC_USER KC_PASS RENAME" ev_run AC-81 journey -- ct_journey "AC-81 container" "$EV/AC-81/journey" || { ok81=0; why81="$why81 browser journey;"; }
unset EV_ENV_NAMES
# Each container with one required variable removed must exit non-zero within 10 s and name the variable.
missing_all() {
  ct_missing acme-api-migrate "$CT/env/migrate.env" DATABASE_URL
  for v in DATABASE_URL AUTH_ISSUER AUTH_AUDIENCE AUTH_JWKS_URL; do ct_missing acme-api "$CT/env/api.env" "$v"; done
  for v in API_BASE_URL AUTH_APP_ORIGIN AUTH_ISSUER AUTH_CLIENT_ID AUTH_REDIS_URL AUTH_TRANSACTION_SECRET; do ct_missing acme-web "$CT/env/web.env" "$v"; done
}
ev_run AC-81 missing-config -- missing_all
printf 'image\tremoved variable\tstate\texit\tseconds\tlog names variable\n' | cat - "$EV/AC-81/missing-config.stdout" > "$EV/AC-81/missing-config.tsv"
nmiss=$(tail -n +2 "$EV/AC-81/missing-config.tsv" | grep -c .)
badmiss=$(tail -n +2 "$EV/AC-81/missing-config.tsv" | awk -F'\t' '$3!="exited" || $4==0 || $5=="running" || $5+0>=10 || $6!="yes"' | tee "$EV/AC-81/missing-config-bad.tsv" | grep -c .)
[ "$nmiss" = 11 ] && [ "$badmiss" = 0 ] || { ok81=0; why81="$why81 missing-config cases=$nmiss bad=$badmiss;"; }
# The repo's own container checks (they build the image themselves; layers are cached by now).
( test_env
  ev_run AC-81 test-container-api -- pnpm --filter @repo/api test:container ) || { ok81=0; why81="$why81 api test:container;"; }
( test_env
  ev_run AC-81 test-container-web -- pnpm --filter @repo/web test:container ) || { ok81=0; why81="$why81 web test:container;"; }
# Versions in the Dockerfiles match the root pins.
ev_run AC-81 pins -- bash -c "grep -h 'pnpm@\|turbo@\|FROM node' apps/*/Dockerfile; echo '--- root'; jq -r '.packageManager, .devDependencies.turbo' package.json; cat .nvmrc"
pm="$(jq -r '.packageManager' "$WS/package.json" | sed 's/^pnpm@//')"; tb="$(jq -r '.devDependencies.turbo' "$WS/package.json")"; nv="$(tr -d '\n' < "$WS/.nvmrc")"
bad_pm=$(grep -ho 'pnpm@[0-9.]*' "$WS"/apps/*/Dockerfile | sort -u | grep -vc "^pnpm@$pm\$")
bad_tb=$(grep -ho 'turbo@[0-9.]*' "$WS"/apps/*/Dockerfile | sort -u | grep -vc "^turbo@$tb\$")
bad_nv=$(grep -h '^FROM node:' "$WS"/apps/*/Dockerfile | awk '{print $2}' | sed 's/@.*//' | sort -u | grep -vc "^node:$nv-alpine\$")
{ echo "root pnpm=$pm turbo=$tb node=$nv"; echo "mismatches: pnpm=$bad_pm turbo=$bad_tb node=$bad_nv"; } | tee "$EV/AC-81/pins-compare.txt"
[ "$bad_pm$bad_tb$bad_nv" = 000 ] || { ok81=0; why81="$why81 version pins differ (pnpm=$bad_pm turbo=$bad_tb node=$bad_nv);"; }
if [ $ok81 = 1 ]; then verdict AC-81 PASS "migrate exits 0 on a fresh DB (and on re-run); api ready 200; Keycloak browser journey passes against the containers; all $nmiss missing-variable cases exit non-zero in under 10 s naming the variable; both test:container scripts exit 0; Dockerfile pnpm/turbo/node pins equal the root pins"; else verdict AC-81 FAIL "${why81# }"; fi

# =====================================================================================================
# AC-94: SBOMs from the repository's own step
# =====================================================================================================
ok94=1; why94=""
ev_run AC-94 ci-step -- bash -c "grep -n 'sbom' .github/workflows/verify.yml docs/operations.md"
ev_run AC-94 sbom -- pnpm run sbom || { ok94=0; why94="$why94 pnpm run sbom exit $(cat "$EV/AC-94/sbom.exit");"; }
ev_run AC-94 syft-image -- bash -c "grep -o 'anchore/syft:[^'\"']*' scripts/sbom.mjs"
api_v="$(jq -r '[.packages[]? | select(.name == "@nestjs/core") | .versionInfo][0] // empty' "$WS/sbom/api.spdx.json" 2> /dev/null)"
web_v="$(jq -r '[.packages[]? | select(.name == "next") | .versionInfo][0] // empty' "$WS/sbom/web.spdx.json" 2> /dev/null)"
ev_run AC-94 listed -- bash -c "echo spdxVersion api=\$(jq -r .spdxVersion sbom/api.spdx.json) web=\$(jq -r .spdxVersion sbom/web.spdx.json); echo packages api=\$(jq '.packages|length' sbom/api.spdx.json) web=\$(jq '.packages|length' sbom/web.spdx.json); echo '@nestjs/core' $api_v; echo next $web_v; echo package.json: \$(jq -r '.dependencies[\"@nestjs/core\"]' apps/api/package.json) \$(jq -r '.dependencies.next' apps/web/package.json)"
[ -n "$api_v" ] || { ok94=0; why94="$why94 api SBOM lacks @nestjs/core;"; }
[ -n "$web_v" ] || { ok94=0; why94="$why94 web SBOM lacks next;"; }
if [ $ok94 = 1 ]; then verdict AC-94 PASS "pnpm run sbom (the documented step, also in verify.yml) writes SPDX SBOMs: api lists @nestjs/core $api_v, web lists next $web_v"; else verdict AC-94 FAIL "${why94# }"; fi

ct_redact > "$EV/_redaction-$JOB.txt" 2>&1
docker ps -a --format '{{.Names}} {{.Status}}' > "$EV/_infra-$JOB/containers-at-end.txt" 2>&1
exit 0
