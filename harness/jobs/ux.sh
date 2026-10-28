#!/bin/bash
# Frontend quality: AC-63, AC-64, AC-65, AC-66, AC-67, AC-68, AC-69, AC-70, AC-71.
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/ux.sh"
provenance || exit 1
secrets_init

# Debug aid while developing: a file harness/jobs/ux.only listing criteria (for example "AC-64 AC-67") limits the run.
ONLY=""; [ -f "$HARNESS/jobs/ux.only" ] && ONLY="$(cat "$HARNESS/jobs/ux.only")"
want() { [ -z "$ONLY" ] || [[ " $ONLY " == *" $1 "* ]]; }
ALL="AC-63 AC-64 AC-65 AC-66 AC-67 AC-68 AC-69 AC-70 AC-71"
fail_all() { local ac; for ac in $ALL; do want "$ac" && verdict "$ac" FAIL "$1"; done; scrub_secrets; exit 0; }

# ---------- Setup: install, production build, services, Chromium ----------
ws_install || fail_all "setup failed: pnpm install --frozen-lockfile exited non-zero (see _setup-ux/install)"
ws_build || fail_all "setup failed: pnpm build exited non-zero (see _setup-ux/build)"
infra_up postgres redis keycloak || fail_all "setup failed: Postgres, Redis or Keycloak did not become healthy"
playwright_install || fail_all "setup failed: Playwright Chromium install failed"
ux_env

# ---------- AC-63 (part 1) and AC-64 (repo spec): the repo's own e2e suite on compiled web + API + disposable DB ----------
ac63_ok=1; ac63_why=""
ac64_spec_ok=1; ac64_spec_why=""
if want AC-63 || want AC-64; then
  ev_run _setup-ux create-e2e-db -- pg_createdb ux_e2e_test
  ( test_env ux_e2e_test; ev_run AC-63 test-e2e -- pnpm test:e2e ); e2e=$?
  f="$EV/AC-63/test-e2e.stdout"; cat "$EV/AC-63/test-e2e.stderr" >> "$f"
  passed="$(pw_total "$f" passed)"; flaky="$(pw_total "$f" flaky)"; skipped="$(pw_total "$f" skipped)"; failed="$(pw_total "$f" failed)"
  echo "passed=$passed flaky=$flaky skipped=$skipped failed=$failed exit=$e2e" > "$EV/AC-63/test-e2e-counts.txt"
  [ "$e2e" = 0 ] || { ac63_ok=0; ac63_why="$ac63_why pnpm test:e2e exit $e2e;"; }
  [ "$passed" -gt 0 ] || { ac63_ok=0; ac63_why="$ac63_why no passed-test count found;"; }
  [ "$flaky" = 0 ] && [ "$skipped" = 0 ] && [ "$failed" = 0 ] || { ac63_ok=0; ac63_why="$ac63_why flaky=$flaky skipped=$skipped failed=$failed;"; }
  # The repo's own accessibility spec, run alone with the list reporter so the result names the test.
  ev_run _setup-ux create-e2e-db2 -- pg_createdb ux_e2e_a11y_test
  ( test_env ux_e2e_a11y_test; ev_run AC-64 repo-accessibility-spec -- pnpm exec turbo run test:e2e -- --reporter=list tests/accessibility.spec.ts ); a11y=$?
  g="$EV/AC-64/repo-accessibility-spec.stdout"; cat "$EV/AC-64/repo-accessibility-spec.stderr" >> "$g"
  [ "$a11y" = 0 ] || { ac64_spec_ok=0; ac64_spec_why="repo accessibility.spec.ts run exit $a11y;"; }
  grep -q 'accessibility.spec.ts' "$g" && grep -qE '✓.*accessibility.spec.ts' "$g" || { ac64_spec_ok=0; ac64_spec_why="$ac64_spec_why no passing accessibility.spec.ts line;"; }
  [ "$(pw_total "$g" passed)" = 1 ] || { ac64_spec_ok=0; ac64_spec_why="$ac64_spec_why expected exactly 1 passed;"; }
fi

# ---------- Services for the browser checks ----------
if ! ux_stack_up; then
  ux_stack_down
  fail_all "setup failed: UX stack (Toxiproxy, API, web) did not start; see _setup-ux and _ux-logs"
fi

# ---------- AC-63 (part 2): persisted state survives a reload and an API restart ----------
if want AC-63; then
  pw AC-63 persistence-restart ac63.cjs || { ac63_ok=0; ac63_why="$ac63_why $(pw_failed AC-63 ac63);"; }
  if [ $ac63_ok = 1 ]; then verdict AC-63 PASS "pnpm test:e2e exit 0 (passed=$passed, 0 flaky, 0 skipped); $(pw_count AC-63 ac63) browser checks: projects created after a real Keycloak sign-in survived a reload and an API process restart"
  else verdict AC-63 FAIL "${ac63_why# }"; fi
fi

# ---------- AC-64 ----------
if want AC-64; then
  ok=1; why=""
  pw AC-64 axe ac64.cjs || { ok=0; why="$(pw_failed AC-64 ac64)"; }
  [ $ac64_spec_ok = 1 ] || { ok=0; why="$why $ac64_spec_why"; }
  if [ $ok = 1 ]; then verdict AC-64 PASS "axe (wcag2a/2aa/21a/21aa/22aa) zero violations in $(pw_count AC-64 ac64) checks across all states at 375x812 and 1440x900; repo accessibility.spec.ts passed"
  else verdict AC-64 FAIL "${why# }"; fi
fi

# ---------- AC-65 ----------
if want AC-65; then
  if pw AC-65 keyboard ac65.cjs; then verdict AC-65 PASS "keyboard-only sign-in, skip link, validation focus, create, open, rename and conflict recovery; every focus stop visible ($(pw_count AC-65 ac65) checks)"
  else verdict AC-65 FAIL "$(pw_failed AC-65 ac65)"; fi
fi

# ---------- AC-66 ----------
if want AC-66; then
  ok=1; why=""
  pw AC-66 states ac66.cjs || { ok=0; why="$why $(pw_failed AC-66 ac66)"; }
  pw AC-66 expiry-sso ac66exp.cjs sso || { ok=0; why="$why $(pw_failed AC-66 ac66exp-sso)"; }
  pw AC-66 expiry-nosso ac66exp.cjs nosso || { ok=0; why="$why $(pw_failed AC-66 ac66exp-nosso)"; }
  pw AC-66 expiry-form ac66exp.cjs form || { ok=0; why="$why $(pw_failed AC-66 ac66exp-form)"; }
  if [ $ok = 1 ]; then verdict AC-66 PASS "empty, API down (retry works), unknown id, other user's id, slow load (CLS<=0.1) and expired session (navigation with and without SSO, and during a form) all show a message and a working next action"
  else verdict AC-66 FAIL "${why# }"; fi
fi

# ---------- AC-67 ----------
if want AC-67; then
  if pw AC-67 forms ac67.cjs; then verdict AC-67 PASS "validation (blank, 101 chars), 409 conflict and API outage (create and rename) keep input, link the error by aria-describedby, announce politely and show pending only in flight ($(pw_count AC-67 ac67) checks)"
  else verdict AC-67 FAIL "$(pw_failed AC-67 ac67)"; fi
fi

# ---------- AC-68 ----------
if want AC-68; then
  if pw AC-68 private-pages ac68.cjs; then verdict AC-68 PASS "private/no-store on pages, data and Server Actions; 20 alternating alice/bob rounds without a leak; after sign-out Back + reload shows sign-in with no private text ($(pw_count AC-68 ac68) checks)"
  else verdict AC-68 FAIL "$(pw_failed AC-68 ac68)"; fi
fi

# ---------- AC-69 ----------
if want AC-69; then
  if pw AC-69 layouts ac69.cjs; then verdict AC-69 PASS "375x812, 1280x800, 2560x1080 and 200% zoom, with and without reduced motion: no horizontal scroll, targets, 16px mobile inputs, no clipping/overlap ($(pw_count AC-69 ac69) checks)"
  else verdict AC-69 FAIL "$(pw_failed AC-69 ac69)"; fi
fi

# ---------- AC-71 ----------
if want AC-71; then
  if pw AC-71 titles-url-state ac71.cjs; then verdict AC-71 PASS "specific unique titles, noindex on every route, ?page=2 and scroll restored on Back/Forward/reload ($(pw_count AC-71 ac71) checks)"
  else verdict AC-71 FAIL "$(pw_failed AC-71 ac71)"; fi
fi

# ---------- AC-70 ----------
if want AC-70; then
  ok=1; why=""
  ev_run AC-70 check-budget-main -- pnpm check:budget || { ok=0; why="$why check:budget failed on main;"; }
  # Lighthouse (pinned) against the production build, mobile preset, authenticated by a session cookie, 20 items, three runs.
  ev_run AC-70 lighthouse-install "$WORK" -- npm install --prefix "$WORK/lh" --no-audit --no-fund "lighthouse@$LIGHTHOUSE_VERSION" || { ok=0; why="$why lighthouse install failed;"; }
  ev_run AC-70 chrome-path "$WS/apps/web" -- node -e "console.log(require('@playwright/test').chromium.executablePath())"
  chrome="$(tail -1 "$EV/AC-70/chrome-path.stdout")"
  export LH_HEADERS="$UXR/lh-headers.json"
  EV_ENV_NAMES="$EV_ENV_NAMES LH_HEADERS" pw AC-70 lighthouse-prep lhprep.cjs || { ok=0; why="$why $(pw_failed AC-70 lhprep);"; }
  mkdir -p "$WORK/lh"
  for n in 1 2 3; do
    EV_ENV_NAMES="CHROME_PATH LH_HEADERS" CHROME_PATH="$chrome" ev_run AC-70 "lighthouse-run$n" -- "$WORK/lh/node_modules/.bin/lighthouse" "$UX_BASE/projects" --preset=perf --extra-headers="$LH_HEADERS" --output=json --output-path="$WORK/lh/run$n.json" "--chrome-flags=--headless=new --no-sandbox" --quiet || { ok=0; why="$why lighthouse run $n exit non-zero;"; }
  done
  ev_run AC-70 lighthouse-summary -- node "$UXI/pw/lhsummary.cjs" "$WORK/lh" "$EV/AC-70" || { ok=0; why="$why $(grep -E '^PROBLEMS' "$EV/AC-70/lighthouse-summary.stdout" | head -1);"; }
  lh_line="$(grep -E '^MEDIAN' "$EV/AC-70/lighthouse-summary.stdout" | head -1)"
  # The budget must fail when exceeded: a throwaway branch imports a ~600 KB module into a client component.
  ux_stack_down
  git -C "$WS" switch -q -c sabotage/AC-70-budget
  head -c 450000 /dev/urandom | base64 -w0 > "$WORK/payload.txt"
  { printf "export const hugeData = '"; cat "$WORK/payload.txt"; printf "';\n"; } > "$WS/apps/web/src/features/projects/components/huge-data.ts"
  python3 - "$WS/apps/web/src/features/projects/components/project-form.tsx" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old_import = "import type { Project } from '../services/types';"
old_form = "<form action={submit} noValidate>"
assert old_import in s and old_form in s
s = s.replace(old_import, old_import + "\nimport { hugeData } from './huge-data';", 1)
s = s.replace(old_form, "<form action={submit} noValidate data-huge={hugeData.charCodeAt(value.length % hugeData.length)}>", 1)
open(p, 'w').write(s)
PY
  git -C "$WS" add apps/web/src/features/projects/components
  git -C "$WS" -c user.name="Rhyu Miranda" -c user.email=rhyu.agapito.miranda@gmail.com commit -qm "test(AC-70): throwaway 600 KB client module"
  { echo "# throwaway branch sabotage/AC-70-budget; huge-data.ts holds a random base64 string of $(wc -c < "$WORK/payload.txt") characters (omitted)"; git -C "$WS" diff HEAD~1 HEAD -- . ':(exclude)apps/web/src/features/projects/components/huge-data.ts'; } > "$EV/AC-70/sabotage-branch.diff"
  ev_run AC-70 sabotage-build -- pnpm build; sb=$?
  ev_run AC-70 sabotage-check-budget -- pnpm check:budget; sc=$?
  cat "$EV/AC-70/sabotage-check-budget.stdout" "$EV/AC-70/sabotage-check-budget.stderr" > "$EV/AC-70/sabotage-check-budget.out"
  [ "$sb" = 0 ] || { ok=0; why="$why sabotage branch build exit $sb (cannot judge budget);"; }
  { [ "$sc" != 0 ] && grep -q 'exceeds' "$EV/AC-70/sabotage-check-budget.out"; } || { ok=0; why="$why check:budget did not fail with an 'exceeds' message on the 600 KB branch (exit $sc);"; }
  if git -C "$WS" switch -q --detach "$TARGET_SHA" && [ "$(git -C "$WS" rev-parse HEAD)" = "$TARGET_SHA" ]; then git -C "$WS" branch -q -D sabotage/AC-70-budget; else ok=0; why="$why could not return to the target commit;"; fi
  if [ $ok = 1 ]; then verdict AC-70 PASS "budget passes on main and fails ('exceeds') on the 600 KB branch; Lighthouse mobile medians of 3: ${lh_line#MEDIAN: }"
  else verdict AC-70 FAIL "${why# }"; fi
fi

ux_stack_down
scrub_secrets
