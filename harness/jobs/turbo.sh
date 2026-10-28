#!/bin/bash
# Task graph, import boundaries, layers, cache behaviour: AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-21.
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/turbo.sh"
provenance || exit 1
secrets_init
TO="timeout 1500"

ws_install || { for a in AC-13 AC-14 AC-15 AC-16 AC-17 AC-18 AC-21; do verdict $a FAIL "pnpm install --frozen-lockfile failed"; done; exit 0; }

# ======================= AC-13: cross-app and server-code imports =======================
mkdir -p "$EV/AC-13"; : > "$EV/AC-13/summary.txt"; ok13=1; why13=""
ac13_case() { # label, regex that a failure message must match to count as naming the offender
  local label="$1" re="$2" failing="" named="" t l code
  fixture_diff AC-13 "$label"
  for t in lint check:arch boundaries typecheck build; do
    l="$label-${t//:/-}"
    ev_run AC-13 "$l" -- $TO pnpm "$t"; code=$?
    if [ $code != 0 ]; then
      failing="$failing $t"
      if grep -Eq "$re" "$EV/AC-13/$l.stdout" "$EV/AC-13/$l.stderr"; then named="$named $t"; fi
    fi
  done
  echo "$label failing=[${failing# }] namingOffender=[${named# }]" >> "$EV/AC-13/summary.txt"
  [ "$(wc -w <<< "$named")" -ge 2 ] || { ok13=0; why13="$why13 ($label) only$( [ -n "$named" ] && echo "$named" || echo ' none') fail naming the offender;"; }
}
neg_start AC-13 a
put apps/web/src/probe.ts <<'X'
import * as api from '../../api/src/projects/service';
export const probe = api;
X
ac13_case a 'probe\.ts|projects/service'
neg_start AC-13 b
jq '.dependencies["@repo/api"] = "workspace:*"' "$WS/apps/web/package.json" > "$WORK/tmp/web-package.json" && cp "$WORK/tmp/web-package.json" "$WS/apps/web/package.json"
put apps/web/src/probe.ts <<'X'
import * as api from '@repo/api';
export const probe = api;
X
ev_run AC-13 b-install -- pnpm install --no-frozen-lockfile
ac13_case b 'probe\.ts|@repo/api'
neg_start AC-13 c
put apps/api/src/probe.ts <<'X'
import * as web from '../../web/src/features/projects/index';
export const probe = web;
X
ac13_case c 'probe\.ts|features/projects'
neg_start AC-13 d
put apps/web/src/probe.ts <<'X'
import pg from 'pg';
export const probe = pg;
X
ac13_case d 'probe\.ts|\bpg\b'
neg_start AC-13 e
jq '.dependencies = ((.dependencies // {}) + {"@repo/web": "workspace:*"})' "$WS/packages/api-client/package.json" > "$WORK/tmp/client-package.json" && cp "$WORK/tmp/client-package.json" "$WS/packages/api-client/package.json"
ev_run AC-13 e-install -- pnpm install --no-frozen-lockfile
ac13_case e '@repo/web|api-client'
restore_main; reinstall AC-13 final
if [ $ok13 = 1 ]; then verdict AC-13 PASS "each of the 5 violations fails at least two of lint, check:arch, boundaries, typecheck, build, with output naming the offending file or package ($(tr '\n' ';' < "$EV/AC-13/summary.txt"))"; else verdict AC-13 FAIL "$why13"; fi

# ======================= AC-14: the four-layer frontend pattern =======================
mkdir -p "$EV/AC-14"; : > "$EV/AC-14/summary.txt"; ok14=1; why14=""
ac14_case() { # label, regex naming the file
  local label="$1" re="$2" a l named
  fixture_diff AC-14 "$label"
  ev_run AC-14 "$label-check-arch" -- $TO pnpm check:arch; a=$?
  ev_run AC-14 "$label-lint" -- $TO pnpm lint; l=$?
  named=0
  for f in check-arch lint; do grep -Eq "$re" "$EV/AC-14/$label-$f.stdout" "$EV/AC-14/$label-$f.stderr" && [ "$(cat "$EV/AC-14/$label-$f.exit")" != 0 ] && named=1; done
  echo "$label check:arch=$a lint=$l namesFile=$named" >> "$EV/AC-14/summary.txt"
  if [ $a = 0 ] && [ $l = 0 ]; then ok14=0; why14="$why14 ($label) passes both check:arch and lint;"
  elif [ $named = 0 ]; then ok14=0; why14="$why14 ($label) failure does not name the file;"; fi
}
neg_start AC-14 a
put apps/web/src/app/page.tsx <<'X'
'use client';
import { createAction } from '@/features/projects/actions/projects';
export default function Home() {
  return (
    <form action={createAction.bind(null, {})}>
      <button>Save</button>
    </form>
  );
}
X
ac14_case a 'page\.tsx|actions/projects'
neg_start AC-14 b
put apps/web/src/app/page.tsx <<'X'
'use client';
export default function Home() {
  return <button onClick={() => fetch('/api/projects')}>Load</button>;
}
X
ac14_case b 'page\.tsx'
neg_start AC-14 c
put apps/web/src/app/page.tsx <<'X'
'use client';
import { listProjects } from '@/features/projects/services/projects.server';
export default function Home() {
  return <button onClick={() => listProjects(1)}>Load</button>;
}
X
ac14_case c 'page\.tsx|projects\.server'
ev_run AC-14 c-next-build -- $TO pnpm --filter @repo/web build; cb=$?
if [ $cb = 0 ] || ! grep -qi 'server-only' "$EV/AC-14/c-next-build.stdout" "$EV/AC-14/c-next-build.stderr"; then ok14=0; why14="$why14 (c) next build did not fail on server-only (exit $cb);"; fi
echo "c next build exit=$cb" >> "$EV/AC-14/summary.txt"
neg_start AC-14 d
put apps/web/src/app/page.tsx <<'X'
'use client';
import { Shared } from '@/components/probe-shared';
export default function Home() {
  return <Shared />;
}
X
put apps/web/src/components/probe-shared.tsx <<'X'
import { createAction } from '@/features/projects/actions/projects';
export function Shared() {
  return <button onClick={() => createAction({}, new FormData())}>Save</button>;
}
X
ac14_case d 'probe-shared|page\.tsx'
neg_start AC-14 e
put apps/web/src/app/page.tsx <<'X'
import { createAction } from '@/features/projects/actions/projects';
import { Probe } from '@/features/projects/components/probe';
export default function Home() {
  return <Probe action={createAction} />;
}
X
put apps/web/src/features/projects/components/probe.tsx <<'X'
'use client';
import { useProbe } from '../hooks/use-probe';
export function Probe({ action }: { action: (...args: never[]) => unknown }) {
  const submit = useProbe(action);
  return <button onClick={() => submit()}>Save</button>;
}
X
put apps/web/src/features/projects/hooks/use-probe.ts <<'X'
'use client';
export function useProbe(action: (...args: never[]) => unknown) {
  return action;
}
X
ac14_case e 'probe\.tsx|use-probe|page\.tsx'
neg_start AC-14 f
put apps/web/src/app/page.tsx <<'X'
export default async function Home() {
  const response = await fetch('http://localhost:3000/api/projects');
  return <p>{response.status}</p>;
}
X
ac14_case f 'page\.tsx'
# Control: a type-only import from services/ must still pass.
neg_start AC-14 type-only
put apps/web/src/app/page.tsx <<'X'
'use client';
import type { ApiError } from '@/features/projects/services/projects.server';
export default function Home() {
  const error: ApiError | null = null;
  return <p>{String(error)}</p>;
}
X
fixture_diff AC-14 type-only
ev_run AC-14 type-only-check-arch -- $TO pnpm check:arch; t1=$?
ev_run AC-14 type-only-lint -- $TO pnpm lint; t2=$?
ev_run AC-14 type-only-next-build -- $TO pnpm --filter @repo/web build; t3=$?
echo "type-only control check:arch=$t1 lint=$t2 next build=$t3" >> "$EV/AC-14/summary.txt"
{ [ $t1 = 0 ] && [ $t2 = 0 ] && [ $t3 = 0 ]; } || { ok14=0; why14="$why14 type-only import is rejected (check:arch=$t1 lint=$t2 build=$t3);"; }
restore_main
if [ $ok14 = 1 ]; then verdict AC-14 PASS "all six violations fail check:arch or lint naming the file; (c) also fails next build on server-only; type-only service import passes ($(tr '\n' ';' < "$EV/AC-14/summary.txt"))"; else verdict AC-14 FAIL "$why14"; fi

# ======================= AC-15: browser output has no server code or config =======================
mkdir -p "$EV/AC-15"
key15="$(printf '%s' 'SENTINEL-AC15-key-0123456789abcd' | base64 -w0)"
export API_BASE_URL=http://SENTINEL-AC15-api.invalid AUTH_CLIENT_SECRET=SENTINEL-AC15-client AUTH_REDIS_URL=redis://SENTINEL-AC15-redis.invalid DATABASE_URL=postgresql://SENTINEL-AC15-db.invalid/ac15 NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$key15"
export EV_ENV_NAMES="API_BASE_URL AUTH_CLIENT_SECRET AUTH_REDIS_URL DATABASE_URL NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"
ev_run AC-15 sentinel-turbo -- $TO pnpm exec turbo run build --force; s1=$?
ev_run AC-15 sentinel-direct -- $TO pnpm --filter @repo/web build; s2=$?
unset API_BASE_URL AUTH_CLIENT_SECRET AUTH_REDIS_URL DATABASE_URL NEXT_SERVER_ACTIONS_ENCRYPTION_KEY EV_ENV_NAMES
ev_run AC-15 browser-grep -- bash -c "grep -rlE '@nestjs|class-validator|pg-protocol|node-postgres|SENTINEL-' apps/web/.next/static || true"
ev_run AC-15 public-secret-names -- bash -c "grep -rnE 'NEXT_PUBLIC_[A-Z_]*(SECRET|KEY|TOKEN|PASSWORD)' apps/web --exclude-dir=node_modules --exclude-dir=.next || true"
ev_run AC-15 key-grep -- bash -c "grep -rlF -e '$key15' -e 'SENTINEL-AC15-key' apps/web/.next/static || true"
# Positive control: the build really saw the sentinels (they must exist somewhere outside the browser assets).
ev_run AC-15 control-server-side -- bash -c "grep -rl 'SENTINEL-AC15' apps/web/.next --include=*.json --include=*.js 2>/dev/null | grep -v '/static/' | head -5 || true"
ev_run AC-15 static-file-count -- bash -c "find apps/web/.next/static -type f | wc -l"
nstatic="$(tr -d ' ' < "$EV/AC-15/static-file-count.stdout")"
if [ $s1 = 0 ] && [ $s2 = 0 ] && [ "${nstatic:-0}" -gt 0 ] && [ ! -s "$EV/AC-15/browser-grep.stdout" ] && [ ! -s "$EV/AC-15/public-secret-names.stdout" ] && [ ! -s "$EV/AC-15/key-grep.stdout" ]; then
  verdict AC-15 PASS "turbo --force and direct next build exit 0 with all five server variables set to sentinels; $nstatic browser asset files; no @nestjs/class-validator/pg-protocol/node-postgres/SENTINEL-/key bytes in .next/static; no NEXT_PUBLIC_*SECRET/KEY/TOKEN/PASSWORD names"
else
  verdict AC-15 FAIL "turboBuild=$s1 directBuild=$s2 staticFiles=$nstatic browserHits=$(wc -l < "$EV/AC-15/browser-grep.stdout") publicNames=$(wc -l < "$EV/AC-15/public-secret-names.stdout") keyHits=$(wc -l < "$EV/AC-15/key-grep.stdout")"
fi

# ======================= AC-16: full cache hit, restored outputs boot =======================
mkdir -p "$EV/AC-16"; restore_main
ev_run AC-16 clean-start -- bash -c 'rm -rf .turbo apps/api/dist apps/web/.next'
ev_run AC-16 build-1 -- $TO pnpm build; b1=$?
ev_run AC-16 build-2 -- $TO pnpm build; b2=$?
full=0; grep -q 'FULL TURBO' "$EV/AC-16/build-2.stdout" "$EV/AC-16/build-2.stderr" && full=1
ev_run AC-16 delete-outputs -- bash -c 'rm -rf apps/api/dist apps/web/.next; test ! -e apps/api/dist/main.js && test ! -e apps/web/.next/standalone && echo outputs-deleted'
rm -rf "$WS/.turbo/runs"
ev_run AC-16 restore-build -- $TO pnpm exec turbo run build --summarize; rb=$?
sum16="$(last_summary)"; hits16=0; total16=0
if [ -n "$sum16" ]; then cp "$sum16" "$EV/AC-16/restore.turbo-run.json"; tasks_tsv "$sum16" "$EV/AC-16/restore.tasks.tsv"; total16="$(wc -l < "$EV/AC-16/restore.tasks.tsv")"; hits16="$(awk -F'\t' '$2=="HIT"' "$EV/AC-16/restore.tasks.tsv" | wc -l)"; fi
ev_run AC-16 artifacts -- bash -c 'test -f apps/api/dist/main.js && test -d apps/web/.next/standalone && sha256sum apps/api/dist/main.js'; art=$?
infra_up postgres; pg16=$?
test_env; export LOGDIR="$EV/AC-16"
EV_ENV_NAMES="NODE_ENV DATABASE_URL LOGDIR" ev_run AC-16 boot-restored -- bash "$HARNESS/infra/turbo/boot-restored.sh"; boot=$?
unset LOGDIR EV_ENV_NAMES; infra_down
api200=0; grep -q 'API live status: 200' "$EV/AC-16/boot-restored.stdout" && api200=1
webok=0; grep -Eq 'WEB root status: (200|30[1-8]) ' "$EV/AC-16/boot-restored.stdout" && webok=1
if [ $b1 = 0 ] && [ $b2 = 0 ] && [ $full = 1 ] && [ $rb = 0 ] && [ "$total16" -gt 0 ] && [ "$hits16" = "$total16" ] && [ $art = 0 ] && [ $pg16 = 0 ] && [ $api200 = 1 ] && [ $webok = 1 ]; then
  verdict AC-16 PASS "2nd build prints FULL TURBO; after deleting dist and .next $hits16/$total16 tasks are cache HIT; dist/main.js and .next/standalone restored; restored API live 200, web root $(sed -n 's/^WEB root status: \([0-9]*\) .*/\1/p' "$EV/AC-16/boot-restored.stdout")"
else
  verdict AC-16 FAIL "build1=$b1 build2=$b2 fullTurbo=$full restoreBuild=$rb hits=$hits16/$total16 artifacts=$art postgres=$pg16 apiLive200=$api200 webOk=$webok boot=$boot"
fi

# ======================= AC-17: cache invalidation is precise =======================
mkdir -p "$EV/AC-17"; : > "$EV/AC-17/summary.txt"; ok17=1; why17=""
restore_main
ev_run AC-17 warm-1 -- $TO pnpm exec turbo run build typecheck lint --summarize
rm -rf "$WS/.turbo/runs"
ev_run AC-17 warm-2 -- $TO pnpm exec turbo run build typecheck lint --summarize; w2=$?
s="$(last_summary)"; [ -n "$s" ] && { cp "$s" "$EV/AC-17/warm-2.turbo-run.json"; tasks_tsv "$s" "$EV/AC-17/warm-2.tsv"; }
if [ $w2 != 0 ] || [ -z "$s" ] || [ -n "$(awk -F'\t' '$2!="HIT"' "$EV/AC-17/warm-2.tsv")" ]; then ok17=0; why17="$why17 baseline is not fully warm;"; fi
ac17_case() { # label, env assignments ("" for none), tasks that must MISS (csv or "-"), tasks that must HIT (csv or "-")
  local label="$1" envs="$2" miss="$3" hit="$4" code sum msg=""
  fixture_diff AC-17 "$label"
  if [ "$envs" = "" ] && [ -z "$(git -C "$WS" status --porcelain)" ]; then ok17=0; why17="$why17 ($label) mutation changed nothing;"; return; fi
  rm -rf "$WS/.turbo/runs"
  EV_ENV_NAMES="$(for kv in $envs; do printf '%s ' "${kv%%=*}"; done)" ev_run AC-17 "$label" -- env $envs $TO pnpm exec turbo run build typecheck lint --summarize; code=$?
  sum="$(last_summary)"
  if [ $code != 0 ] || [ -z "$sum" ]; then ok17=0; why17="$why17 ($label) turbo exit $code;"; return; fi
  cp "$sum" "$EV/AC-17/$label.turbo-run.json"; tasks_tsv "$sum" "$EV/AC-17/$label.tsv"
  [ "$miss" = "-" ] || msg="$msg$(want_status "$EV/AC-17/$label.tsv" MISS "$miss")"
  [ "$hit" = "-" ] || msg="$msg$(want_status "$EV/AC-17/$label.tsv" HIT "$hit")"
  echo "$label: $(tr '\t\n' ' |' < "$EV/AC-17/$label.tsv")  => ${msg:-ok}" >> "$EV/AC-17/summary.txt"
  [ -z "$msg" ] || { ok17=0; why17="$why17 ($label) ${msg//$'\n'/; };"; }
}
neg_start AC-17 web-comment;  printf '\n// AC-17 comment\n' >> "$WS/apps/web/src/app/page.tsx"
ac17_case web-comment "" "@repo/web#build,@repo/web#typecheck,@repo/web#lint" "@repo/api#*"
neg_start AC-17 api-comment;  printf '\n// AC-17 comment\n' >> "$WS/apps/api/src/projects/service.ts"
ac17_case api-comment "" "@repo/api#build,@repo/api#typecheck,@repo/api#lint" "@repo/web#*"
neg_start AC-17 client-type;  printf '\nexport type Ac17Probe = { readonly value: string };\n' >> "$WS/packages/api-client/src/api.d.ts"
ac17_case client-type "" "@repo/web#typecheck,@repo/web#build" "@repo/api#build"
neg_start AC-17 tsconfig-flag; jq '.compilerOptions.forceConsistentCasingInFileNames = true' "$WS/packages/typescript-config/base.json" > "$WORK/tmp/base.json" && cp "$WORK/tmp/base.json" "$WS/packages/typescript-config/base.json"
ac17_case tsconfig-flag "" "@repo/web#typecheck,@repo/web#build,@repo/api#typecheck,@repo/api#build" "-"
neg_start AC-17 eslint-rule;  sed -i "s/rules: { 'no-restricted-imports'/rules: { 'no-debugger': 'error', 'no-restricted-imports'/" "$WS/packages/eslint-config/base.mjs"
ac17_case eslint-rule "" "@repo/web#lint,@repo/api#lint" "-"
key17="$(printf '%s' 'SENTINEL-AC17-key-0123456789abcd' | base64 -w0)"
neg_start AC-17 env-deployment-id
ac17_case env-deployment-id "APP_DEPLOYMENT_ID=ac17-deploy" "@repo/web#build" "@repo/api#build"
neg_start AC-17 env-action-key
ac17_case env-action-key "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$key17" "@repo/web#build" "@repo/api#build"
neg_start AC-17 env-database-url
ac17_case env-database-url "DATABASE_URL=postgresql://SENTINEL-AC17.invalid/ac17_test" "-" "@repo/api#build,@repo/web#build"
neg_start AC-17 env-github-token
ac17_case env-github-token "GITHUB_TOKEN=SENTINEL-AC17-token" "-" "@repo/api#build,@repo/web#build"
neg_start AC-17 env-foo
ac17_case env-foo "FOO=1" "-" "@repo/api#build,@repo/web#build"
neg_start AC-17 web-docs;     printf '\nAC-17 doc edit.\n' >> "$WS/apps/web/docs/architecture.md"
ac17_case web-docs "" "-" "@repo/api#build"
neg_start AC-17 api-docs;     printf '\nAC-17 doc edit.\n' >> "$WS/apps/api/docs/architecture.md"
ac17_case api-docs "" "-" "@repo/web#build"
neg_start AC-17 root-readme;  printf '# acme-app\n\nAC-17 readme.\n' > "$WS/README.md"
ac17_case root-readme "" "-" "@repo/api#build,@repo/web#build"
neg_start AC-17 root-docs;    printf '\nAC-17 doc edit.\n' >> "$WS/docs/operations.md"
ac17_case root-docs "" "-" "@repo/api#build,@repo/web#build"
restore_main
if [ $ok17 = 1 ]; then verdict AC-17 PASS "all 13 change rows match the Must MISS and Must HIT columns from a fully warm cache"; else verdict AC-17 FAIL "$why17"; fi

# ======================= AC-18: builds are pure; side-effect tasks are uncached =======================
mkdir -p "$EV/AC-18"
infra_down
ev_run AC-18 running-containers -- bash -c 'docker ps --format "{{.Names}} {{.Image}}"; echo "count=$(docker ps -q | wc -l)"'
ev_run AC-18 forced-build-clean-env -- $TO env -i PATH="$PATH" HOME="$HOME" pnpm exec turbo run build --force; fb=$?
OUT="$WORK/tmp" ev_run AC-18 build-dry -- bash -c 'pnpm exec turbo run build --dry=json > "$OUT/build-dry.json" && jq ".tasks[] | {taskId, dependencies}" "$OUT/build-dry.json"'; dr=$?
ev_run AC-18 turbo-tasks -- jq '.tasks' turbo.json
ev_run AC-18 graph-check -- python3 -I "$HARNESS/infra/turbo/graph.py" turbo.json "$WORK/tmp/build-dry.json"; gc=$?
if [ $fb = 0 ] && [ $dr = 0 ] && [ $gc = 0 ]; then
  verdict AC-18 PASS "forced build with empty environment and no services exits 0; no build task depends on migrate, contract:generate or test:*; migrate, contract:generate (//#), test:integration, test:runtime, test:e2e are cache false; dev persistent, interruptible, uncached"
else
  verdict AC-18 FAIL "forcedBuild=$fb dryRun=$dr graphCheck=$gc ($(grep PROBLEM "$EV/AC-18/graph-check.stdout" | tr '\n' ';'))"
fi

# ======================= AC-21: remote cache can be enabled safely =======================
mkdir -p "$EV/AC-21"; restore_main
store="$WORK/remote-store"; rm -rf "$store"; mkdir -p "$store"; chmod 777 "$store"
printf '%s\n' "$(openssl rand -hex 32)" > "$WORK/.turbo-token"; printf '%s\n' "$(openssl rand -base64 48)" > "$WORK/.turbo-sigkey"; chmod 600 "$WORK/.turbo-token" "$WORK/.turbo-sigkey"
TURBO_TOKEN="$(cat "$WORK/.turbo-token")"; TURBO_REMOTE_CACHE_SIGNATURE_KEY="$(cat "$WORK/.turbo-sigkey")"
export TURBO_API=http://127.0.0.1:50921 TURBO_TEAM=acme TURBO_TOKEN TURBO_REMOTE_CACHE_SIGNATURE_KEY
echo "::add-mask::$TURBO_TOKEN"; echo "::add-mask::$TURBO_REMOTE_CACHE_SIGNATURE_KEY"
export EV_ENV_NAMES="TURBO_API TURBO_TEAM TURBO_TOKEN TURBO_REMOTE_CACHE_SIGNATURE_KEY"
ev_run AC-21 docs -- bash -c "sed -n '/^## Remote cache/,/^## Removing/p' docs/operations.md; jq .remoteCache turbo.json"
docs_ok=0; grep -q 'TURBO_REMOTE_CACHE_SIGNATURE_KEY' "$EV/AC-21/docs.stdout" && grep -q 'TURBO_API' "$EV/AC-21/docs.stdout" && grep -q 'TURBO_TEAM' "$EV/AC-21/docs.stdout" && grep -q 'TURBO_TOKEN' "$EV/AC-21/docs.stdout" && jq -e '.remoteCache.signature == true' "$WS/turbo.json" >/dev/null && docs_ok=1
ev_run AC-21 server-start -- docker run -d --name acc-remote-cache --cpus=2 --memory=2g -p 127.0.0.1:50921:3000 -v "$store":/data -e TURBO_TOKEN -e TURBO_REMOTE_CACHE_SIGNATURE_KEY -e STORAGE_PROVIDER=local -e STORAGE_PATH=/data -e STORAGE_PATH_USE_TMP_FOLDER=false -e LOG_LEVEL=info "$DUCKTORS_IMAGE"; ss21=$?
ev_run AC-21 server-ready -- bash -c 'for n in $(seq 1 120); do c=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:50921/ 2>/dev/null); [ "$c" != 000 ] && { echo "ready http $c after $n tries"; exit 0; }; sleep 0.5; done; exit 1'; sr=$?
ev_run AC-21 clear-local -- bash -c 'rm -rf .turbo apps/api/dist apps/web/.next && echo cleared'
ev_run AC-21 upload -- $TO pnpm build; up=$?
ev_run AC-21 hash-before -- sha256sum apps/api/dist/main.js
ev_run AC-21 stored-artifacts -- bash -c "find '$store' -type f | wc -l; find '$store' -type f -maxdepth 3 | sort | head -20"
ev_run AC-21 clear-local-2 -- bash -c 'rm -rf .turbo/cache apps/api/dist apps/web/.next && echo cleared'
ev_run AC-21 refetch -- $TO pnpm exec turbo run build --summarize; rf=$?
sum="$(last_summary)"; remote_ok=0
if [ -n "$sum" ]; then cp "$sum" "$EV/AC-21/refetch.turbo-run.json"; tasks_tsv "$sum" "$EV/AC-21/refetch.tsv"; [ -s "$EV/AC-21/refetch.tsv" ] && [ -z "$(awk -F'\t' '$2!="HIT" || $3!="REMOTE"' "$EV/AC-21/refetch.tsv")" ] && remote_ok=1; fi
ev_run AC-21 hash-after-refetch -- sha256sum apps/api/dist/main.js
hash_api="$(jq -r '.tasks[] | select(.taskId=="@repo/api#build") | .hash' "$sum" 2>/dev/null)"
art="$(find "$store" -type f -name "$hash_api*" 2>/dev/null | head -1)"
if [ -n "$art" ]; then ev_run AC-21 byteflip -- sudo python3 -I "$HARNESS/infra/turbo/flip-byte.py" "$art"; flip=$?; else flip=1; echo "artifact for @repo/api#build ($hash_api) not found in store" > "$EV/AC-21/byteflip.missing"; fi
ev_run AC-21 clear-local-3 -- bash -c 'rm -rf .turbo/cache apps/api/dist apps/web/.next && echo cleared'
rm -rf "$WS/.turbo/runs"
ev_run AC-21 tampered-refetch -- $TO pnpm exec turbo run build --summarize; tr_=$?
sum="$(last_summary)"; tamper_ok=0; api_status="-"
if [ -n "$sum" ]; then cp "$sum" "$EV/AC-21/tampered.turbo-run.json"; tasks_tsv "$sum" "$EV/AC-21/tampered.tsv"; api_status="$(awk -F'\t' '$1=="@repo/api#build"{print $2}' "$EV/AC-21/tampered.tsv")"; fi
ev_run AC-21 hash-after-tamper -- sha256sum apps/api/dist/main.js
[ "$api_status" = MISS ] && cmp -s "$EV/AC-21/hash-before.stdout" "$EV/AC-21/hash-after-tamper.stdout" && tamper_ok=1
ev_run AC-21 server-logs -- docker logs acc-remote-cache
tracked_clean AC-21 tracked-status; tc=$?
docker rm -f acc-remote-cache >/dev/null 2>&1; unset TURBO_API TURBO_TEAM TURBO_TOKEN TURBO_REMOTE_CACHE_SIGNATURE_KEY EV_ENV_NAMES; rm -f "$WORK/.turbo-token" "$WORK/.turbo-sigkey"
if [ $docs_ok = 1 ] && [ $ss21 = 0 ] && [ $sr = 0 ] && [ $up = 0 ] && [ $rf = 0 ] && [ $remote_ok = 1 ] && [ $flip = 0 ] && [ $tr_ = 0 ] && [ $tamper_ok = 1 ] && [ $tc = 0 ]; then
  verdict AC-21 PASS "docs/operations.md documents TURBO_API/TEAM/TOKEN and the signature key, turbo.json remoteCache.signature true; signed upload then all tasks HIT from REMOTE; byte-flipped @repo/api#build artifact -> MISS, rebuilt, main.js hash identical; no tracked file edited"
else
  verdict AC-21 FAIL "docs=$docs_ok server=$ss21 ready=$sr upload=$up refetch=$rf allRemoteHit=$remote_ok flip=$flip tamperedBuildExit=$tr_ apiStatusAfterTamper=$api_status outputCorrect=$tamper_ok trackedClean=$tc"
fi
restore_main
