#!/bin/bash
# The generator itself: AC-01 .. AC-08. Runs the skills snapshot committed in harness/skills (byte-identical to the
# installed skill; tree hash in TARGET.json). Every generation goes under $WORK, whose name contains a space.
. "$(dirname "$0")/../lib/common.sh"
. "$(dirname "$0")/../lib/generator.sh"
provenance || exit 1
secrets_init

# The snapshot must be the skill that produced the published commit.
snap_tree="$(grep '^skill tree (snapshot):' "$EV/_provenance-$JOB/provenance.txt" | awk '{print $NF}')"
[ "$snap_tree" = "$TARGET_TREE" ] || { echo "skills snapshot tree $snap_tree != TARGET.json $TARGET_TREE"; exit 1; }

# ---------- AC-01: dry run writes nothing ----------
T="$WORK/tmp/ac01"; mkdir -p "$T" "$EV/AC-01"
snap01() {
  { find "$WORK" \( -path "$EV" -o -path "$RES" -o -path "$WORK/.secrets" -o -path "$WS" \) -prune -o -print; echo '--- TMPDIR'; find "$T"; echo '--- gen'; ls -la "$GEN"; } | sed -E 's/ +[0-9]{1,2} [A-Z][a-z]{2} +[0-9:]+ / DATE /' | LC_ALL=C sort
}
snap01 > "$EV/AC-01/before.txt"; touch "$EV/AC-01/.marker"
gen_run AC-01 dryrun "$T" -- --destination "$GEN/dry" --name dry-app --intake "$INTAKE" --dry-run; c01=$?
snap01 > "$EV/AC-01/after.txt"
diff -u "$EV/AC-01/before.txt" "$EV/AC-01/after.txt" > "$EV/AC-01/snapshot.diff"; d01=$?
# Same dry run in a container with no network and a read-only root file system (extra evidence).
mkdir -p "$WORK/skills-ro" && cp -R "$HARNESS/skills/." "$WORK/skills-ro/" && cp "$INTAKE" "$WORK/skills-ro/intake.json"
mkdir -p "$WORK/ac01-ro-out"
ev_run AC-01 dryrun-readonly-container -- docker run --rm --cpus=2 --memory=2g --network none --read-only --user "$(id -u):$(id -g)" -v "$WORK/skills-ro":/skills:ro -v "$WORK/ac01-ro-out":/out:ro "$NODE_IMAGE" node /skills/scaffold-turbo-nest-next/scripts/scaffold.mjs --destination /out/dry --name dry-app --intake /skills/intake.json --dry-run
ev_run AC-01 jq-check -- jq -e --arg d "$GEN/dry" --slurpfile i "$INTAKE" '.destination==$d and .name=="dry-app" and (.layout|length)==5 and (.versions|type=="object" and length>0) and .intake==$i[0]' "$EV/AC-01/dryrun.stdout"; j01=$?
if [ $c01 = 0 ] && [ $j01 = 0 ] && [ ! -e "$GEN/dry" ] && [ $d01 = 0 ]; then
  verdict AC-01 PASS "dry run exit 0; JSON has destination, 5-entry layout, versions, intake; destination absent; no new file under \$WORK or TMPDIR (snapshot diff empty); read-only/no-network container exit $(cat "$EV/AC-01/dryrun-readonly-container.exit")"
else
  verdict AC-01 FAIL "exit=$c01 jsonCheck=$j01 destExists=$([ -e "$GEN/dry" ] && echo yes || echo no) snapshotDiff=$d01"
fi

# ---------- AC-02: unsafe inputs are refused without side effects ----------
T="$WORK/tmp/ac02"; mkdir -p "$T"; base="$GEN/ac02"; mkdir -p "$base/empty" "$base/nonempty/sub" "$WORK/intakes"
printf 'precious\n' > "$base/nonempty/keep.txt"; printf 'nested\n' > "$base/nonempty/sub/inner.txt"
mkdir -p "$EV/AC-02"; dir_state "$base/empty" > "$EV/AC-02/empty-before.txt"
dir_state "$base/nonempty" > "$EV/AC-02/nonempty-before.txt"
jq '. + {extra: 1}' "$INTAKE" > "$WORK/intakes/unknown.json"
jq 'del(.deployment)' "$INTAKE" > "$WORK/intakes/missing.json"
jq '.database = "mysql"' "$INTAKE" > "$WORK/intakes/mysql.json"
jq '.auth = "magic"' "$INTAKE" > "$WORK/intakes/magic.json"
long65="$(printf 'a%.0s' $(seq 1 65))"
ok02=1; why02=""
c02() { # label, message regex, destination that must not exist ("-" for none), generator args...
  local label="$1" re="$2" chk="$3"; shift 3
  mkdir -p "$T"; EV_ENV_NAMES=TMPDIR ev_run AC-02 "$label" "$base" -- env TMPDIR="$T" node "$SK/scripts/scaffold.mjs" "$@"; local code=$?
  if [ $code = 0 ]; then ok02=0; why02="$why02 $label:exit0;"; return; fi
  grep -Eq "$re" "$EV/AC-02/$label.stderr" "$EV/AC-02/$label.stdout" || { ok02=0; why02="$why02 $label:message-missing;"; }
  if [ "$chk" != "-" ] && [ -e "$chk" ]; then ok02=0; why02="$why02 $label:destination-created;"; fi
  printf '%s exit=%s %s\n' "$label" "$code" "$(grep -hE 'Error' "$EV/AC-02/$label.stderr" | head -1)" >> "$EV/AC-02/summary.txt"
}
: > "$EV/AC-02/summary.txt"
c02 existing-empty 'Destination exists' - --destination "$base/empty" --name acme-app --intake "$INTAKE"
c02 existing-nonempty 'Destination exists' - --destination "$base/nonempty" --name acme-app --intake "$INTAKE"
c02 relative-path 'absolute destination' "$base/rel-dest" --destination rel-dest --name acme-app --intake "$INTAKE"
c02 dotdot-path 'absolute destination|traversal' "$base/dotdot-dest" --destination "$base/x/../dotdot-dest" --name acme-app --intake "$INTAKE"
c02 name-Acme 'Invalid name' "$base/n1" --destination "$base/n1" --name Acme --intake "$INTAKE"
c02 name-1acme 'Invalid name' "$base/n2" --destination "$base/n2" --name 1acme --intake "$INTAKE"
c02 name-underscore 'Invalid name' "$base/n3" --destination "$base/n3" --name acme_app --intake "$INTAKE"
c02 name-semicolon 'Invalid name' "$base/n4" --destination "$base/n4" --name 'a;rm -rf' --intake "$INTAKE"
c02 name-65-chars 'Invalid name.*65' "$base/n5" --destination "$base/n5" --name "$long65" --intake "$INTAKE"
c02 intake-unknown-field 'unknown field extra' "$base/i1" --destination "$base/i1" --name acme-app --intake "$WORK/intakes/unknown.json"
c02 intake-missing-field 'missing deployment' "$base/i2" --destination "$base/i2" --name acme-app --intake "$WORK/intakes/missing.json"
c02 intake-mysql 'invalid or missing database' "$base/i3" --destination "$base/i3" --name acme-app --intake "$WORK/intakes/mysql.json"
c02 intake-magic 'invalid or missing auth' "$base/i4" --destination "$base/i4" --name acme-app --intake "$WORK/intakes/magic.json"
dir_state "$base/empty" > "$EV/AC-02/empty-after.txt"; dir_state "$base/nonempty" > "$EV/AC-02/nonempty-after.txt"
cmp -s "$EV/AC-02/empty-before.txt" "$EV/AC-02/empty-after.txt" || { ok02=0; why02="$why02 empty folder changed;"; }
cmp -s "$EV/AC-02/nonempty-before.txt" "$EV/AC-02/nonempty-after.txt" || { ok02=0; why02="$why02 non-empty folder changed;"; }
ls -A "$T" > "$EV/AC-02/tmpdir-after.txt"
[ ! -s "$EV/AC-02/tmpdir-after.txt" ] || { ok02=0; why02="$why02 leftover in TMPDIR: $(tr '\n' ' ' < "$EV/AC-02/tmpdir-after.txt");"; }
if [ $ok02 = 1 ]; then verdict AC-02 PASS "13/13 cases exit non-zero naming the problem; both existing folders byte-identical; no destination created; TMPDIR empty"; else verdict AC-02 FAIL "$why02"; fi

# ---------- AC-03: wrong companion version is refused before anything is written ----------
T="$WORK/tmp/ac03"; mkdir -p "$T"; ok03=1; why03=""
patch_companion() { # label, sed expression
  local copy="$WORK/skills-ac03-$1"; rm -rf "$copy"; mkdir -p "$copy"; cp -R "$HARNESS/skills/scaffold-nest" "$copy/scaffold-nest"
  sed -i "$2" "$copy/scaffold-nest/scripts/scaffold.mjs"
  diff -u "$HARNESS/skills/scaffold-nest/scripts/scaffold.mjs" "$copy/scaffold-nest/scripts/scaffold.mjs" > "$EV/AC-03/$1-companion.diff"
  # exactly one line may differ
  [ "$(grep -c '^+[^+]' "$EV/AC-03/$1-companion.diff")" = 1 ] && [ "$(grep -c '^-[^-]' "$EV/AC-03/$1-companion.diff")" = 1 ]
}
mkdir -p "$EV/AC-03"
for spec in "version|s/referenceVersion:'1.4.0'/referenceVersion:'1.4.9'/" "runtime|s/runtime:'24.22.1'/runtime:'24.22.0'/"; do
  label="${spec%%|*}"; expr="${spec#*|}"
  patch_companion "$label" "$expr" || { ok03=0; why03="$why03 $label: patch did not change exactly one line;"; continue; }
  dest="$GEN/ac03-$label"
  mkdir -p "$T"; EV_ENV_NAMES=TMPDIR ev_run AC-03 "wrong-$label" -- env TMPDIR="$T" node "$SK/scripts/scaffold.mjs" --destination "$dest" --name acme-app --intake "$INTAKE" --nest-skill "$WORK/skills-ac03-$label/scaffold-nest"; code=$?
  [ $code != 0 ] || { ok03=0; why03="$why03 $label: exit 0;"; }
  grep -q 'Unsupported nest reference' "$EV/AC-03/wrong-$label.stderr" || { ok03=0; why03="$why03 $label: no 'Unsupported nest reference' message;"; }
  [ ! -e "$dest" ] || { ok03=0; why03="$why03 $label: destination created;"; }
done
ls -A "$T" > "$EV/AC-03/tmpdir-after.txt"
[ ! -s "$EV/AC-03/tmpdir-after.txt" ] || { ok03=0; why03="$why03 staging folder left: $(tr '\n' ' ' < "$EV/AC-03/tmpdir-after.txt");"; }
if [ $ok03 = 1 ]; then verdict AC-03 PASS "companion reference 1.4.9 and runtime 24.22.0 variants exit non-zero with 'Unsupported nest reference'; destination absent; staging folder removed"; else verdict AC-03 FAIL "$why03"; fi

# ---------- AC-04: interrupted generation is visible and cannot be silently resumed ----------
T="$WORK/tmp/ac04"; mkdir -p "$T" "$EV/AC-04"; ok04=0; why04="no attempt killed the generator while it was writing"
for n in 1 2 3 4 5 6 7 8 9 10; do
  dest="$GEN/ac04-$n"
  EV_ENV_NAMES="SK INTAKE TMPDIR" ev_run AC-04 "kill-run-$n" -- env SK="$SK" INTAKE="$INTAKE" TMPDIR="$T" bash "$HARNESS/infra/generator/kill-run.sh" "$dest"
  if grep -q 'killed=1' "$EV/AC-04/kill-run-$n.stdout"; then
    ev_run AC-04 list-dest -- bash -c "ls -la '$dest'; find '$dest' -maxdepth 2 | sort; test -e '$dest/.scaffold-in-progress' && echo MARKER-PRESENT; test -e '$dest/scaffold-manifest.json' && echo MANIFEST-PRESENT || echo MANIFEST-ABSENT"
    gen_run AC-04 rerun "$T" -- --destination "$dest" --name acme-app --intake "$INTAKE"; rc=$?
    ls -A "$T" > "$EV/AC-04/staging-after-kill.txt"
    if [ -e "$dest/.scaffold-in-progress" ] && [ ! -e "$dest/scaffold-manifest.json" ] && [ $rc != 0 ] && grep -q 'Destination exists' "$EV/AC-04/rerun.stderr"; then
      ok04=1; why04="attempt $n"
    else
      why04="attempt $n: marker=$([ -e "$dest/.scaffold-in-progress" ] && echo yes || echo no) manifest=$([ -e "$dest/scaffold-manifest.json" ] && echo yes || echo no) rerunExit=$rc"
    fi
    break
  fi
done
if [ $ok04 = 1 ]; then verdict AC-04 PASS "SIGKILL once apps/ existed ($why04): .scaffold-in-progress present, no scaffold-manifest.json; re-run exit non-zero with 'Destination exists' (SIGKILL leaves its staging folder in TMPDIR, as expected)"; else verdict AC-04 FAIL "$why04"; fi

# ---------- AC-05: generation is deterministic ----------
T="$WORK/tmp/ac05"; mkdir -p "$T"; mkdir -p "$EV/AC-05"
gen_run AC-05 gen-a "$T" -- --destination "$GEN/a" --name acme-app --intake "$INTAKE"; ga=$?
gen_run AC-05 gen-b "$T" -- --destination "$GEN/b" --name acme-app --intake "$INTAKE"; gb=$?
hashes() { ( cd "$1" && find . -type f ! -name scaffold-manifest.json -print0 | LC_ALL=C sort -z | xargs -0 sha256sum ); }
hashes "$GEN/a" > "$EV/AC-05/hash-a.txt"; hashes "$GEN/b" > "$EV/AC-05/hash-b.txt"
diff "$EV/AC-05/hash-a.txt" "$EV/AC-05/hash-b.txt" > "$EV/AC-05/diff-hashes.txt"; dh=$?
diff <(jq 'del(.generatedAt,.generatorCommand)' "$GEN/a/scaffold-manifest.json") <(jq 'del(.generatedAt,.generatorCommand)' "$GEN/b/scaffold-manifest.json") > "$EV/AC-05/diff-manifests.txt"; dm=$?
manifest_checksums_ok "$GEN/a" > "$EV/AC-05/verify-a.txt" 2>&1; va=$?
manifest_checksums_ok "$GEN/b" > "$EV/AC-05/verify-b.txt" 2>&1; vb=$?
# Comparison with the main generation (the published commit, fresh clone in $WS): tracked files only, manifest excluded.
( cd "$WS" && git ls-files -z | grep -zv '^scaffold-manifest.json$' | LC_ALL=C sort -z | xargs -0 sha256sum | sed 's#  #  ./#' ) > "$EV/AC-05/hash-published.txt"
diff "$EV/AC-05/hash-a.txt" "$EV/AC-05/hash-published.txt" > "$EV/AC-05/diff-vs-published.txt"; dp=$?
diff <(jq 'del(.generatedAt,.generatorCommand)' "$GEN/a/scaffold-manifest.json") <(jq 'del(.generatedAt,.generatorCommand)' "$WS/scaffold-manifest.json") > "$EV/AC-05/diff-manifest-vs-published.txt"; dpm=$?
n05="$(wc -l < "$EV/AC-05/hash-a.txt")"
if [ $ga = 0 ] && [ $gb = 0 ] && [ $dh = 0 ] && [ $dm = 0 ] && [ $va = 0 ] && [ $vb = 0 ] && [ "$n05" -gt 0 ]; then
  verdict AC-05 PASS "$n05 file hashes identical across two generations; manifests equal minus generatedAt/generatorCommand; every manifest checksum matches, no unlisted file; versus published commit: files diff=$dp manifest diff=$dpm (0 = identical)"
else
  verdict AC-05 FAIL "gen a=$ga b=$gb hashDiff=$dh manifestDiff=$dm verifyA=$va verifyB=$vb"
fi

# ---------- AC-06: no hidden side effects (no network, no install, no git, nothing left in /tmp) ----------
rm -rf "$WORK/skills-ro/intake.json"
mkdir -p "$WORK/ac06-out" "$EV/AC-06"
ev_run AC-06 network-none -- docker run --rm --cpus=2 --memory=2g --network none --user "$(id -u):$(id -g)" -v "$WORK/skills-ro":/skills:ro -v "$WORK/ac06-out":/out "$NODE_IMAGE" sh -c 'ls -A /tmp > /out/tmp-before.txt; node /skills/scaffold-turbo-nest-next/scripts/scaffold.mjs --destination /out/x --name x; rc=$?; echo "generator exit $rc"; echo "container /tmp after:"; ls -A /tmp; echo end-tmp-listing; exit $rc'; n06=$?
ev_run AC-06 inspect-out -- bash -c "find '$WORK/ac06-out/x' \\( -name node_modules -o -name .git \\) | wc -l; ls -A '$WORK/ac06-out' '$WORK/ac06-out/x'"
mkdir -p "$WORK/ac06-out2"
ev_run AC-06 network-none-readonly-rootfs -- docker run --rm --cpus=2 --memory=2g --network none --read-only --tmpfs /tmp --user "$(id -u):$(id -g)" -v "$WORK/skills-ro":/skills:ro -v "$WORK/ac06-out2":/out "$NODE_IMAGE" sh -c 'node /skills/scaffold-turbo-nest-next/scripts/scaffold.mjs --destination /out/x --name x >/dev/null; rc=$?; echo "generator exit $rc"; echo "/tmp entries: $(ls -A /tmp | wc -l)"; exit $rc'; r06=$?
bad06="$(head -1 "$EV/AC-06/inspect-out.stdout" | tr -d ' ')"
left06="$(sed -n '/^container \/tmp after:/,/^end-tmp-listing/p' "$EV/AC-06/network-none.stdout" | grep -v -e 'container /tmp after' -e end-tmp-listing | grep -c .)"
if [ $n06 = 0 ] && [ $r06 = 0 ] && [ "$bad06" = 0 ] && [ -f "$WORK/ac06-out/x/scaffold-manifest.json" ] && [ "$left06" = 0 ]; then
  verdict AC-06 PASS "exit 0 with --network none (and read-only rootfs); no node_modules or .git in output; container /tmp empty afterwards"
else
  verdict AC-06 FAIL "networkNone=$n06 readonlyRootfs=$r06 nodeModulesOrGit=$bad06 containerTmpLeft=$left06 manifest=$([ -f "$WORK/ac06-out/x/scaffold-manifest.json" ] && echo yes || echo no)"
fi

# ---------- AC-07: the generator's own tests ----------
T="$WORK/tmp/ac07"; mkdir -p "$T"; skills07="$WORK/skills-test"; rm -rf "$skills07"; mkdir -p "$skills07"; cp -R "$HARNESS/skills/." "$skills07/"
ok07=1; why07=""
for s in scaffold-turbo-nest-next scaffold-nest scaffold-next; do
  EV_ENV_NAMES=TMPDIR ev_run AC-07 "test-$s" "$skills07/$s" -- env TMPDIR="$T" bash -c 'node --test scripts/*.test.mjs'; code=$?
  f="$EV/AC-07/test-$s.stdout"
  t="$(tapnum "$f" tests)"; fl="$(tapnum "$f" fail)"; ca="$(tapnum "$f" cancelled)"; sk="$(tapnum "$f" skipped)"; td="$(tapnum "$f" todo)"
  echo "$s tests=$t fail=$fl cancelled=$ca skipped=$sk todo=$td exit=$code" >> "$EV/AC-07/summary.txt"
  [ $code = 0 ] && [ "${t:-0}" -gt 0 ] && [ "${fl:-1}" = 0 ] && [ "${ca:-1}" = 0 ] && [ "${sk:-1}" = 0 ] && [ "${td:-1}" = 0 ] || { ok07=0; why07="$why07 $s(exit=$code tests=$t fail=$fl cancelled=$ca skipped=$sk todo=$td);"; }
done
if [ $ok07 = 1 ]; then verdict AC-07 PASS "all three suites exit 0: $(awk '{printf "%s %s; ", $1, $2}' "$EV/AC-07/summary.txt") zero fail, cancelled, skipped, todo"; else verdict AC-07 FAIL "$why07"; fi

# ---------- AC-08: the manifest does not overclaim ----------
mkdir -p "$EV/AC-08"
ev_run AC-08 manifest-fields -- jq '{status,deployment,authIntegration,gateStatuses:([.gates[].status]|unique),requirementStatuses:([.requirements[].status]|unique),gates:(.gates|length),requirements:(.requirements|length)}' scaffold-manifest.json
ev_run AC-08 manifest-fields-fresh -- jq '{status,deployment,authIntegration,gateStatuses:([.gates[].status]|unique),requirementStatuses:([.requirements[].status]|unique)}' "$GEN/a/scaffold-manifest.json"
fields_ok=0
jq -e '.status=="generated" and .deployment=="unverified" and (.authIntegration|test("^integrated")|not) and ([.gates[].status]|unique)==["not_run"] and ([.requirements[].status]|unique)==["not_run"] and (.gates|length)>0 and (.requirements|length)>0' "$WS/scaffold-manifest.json" "$GEN/a/scaffold-manifest.json" > "$EV/AC-08/fields-check.txt" && fields_ok=1
# The checker verifies sibling files, so each tampered manifest lives in a full copy of the repository.
tamper() { # label, jq filter
  local d="$WORK/ac08-$1"; rm -rf "$d"; mkdir -p "$d"; git -C "$WS" archive HEAD | tar -x -C "$d"
  jq "$2" "$d/scaffold-manifest.json" > "$d/m.tmp" && mv "$d/m.tmp" "$d/scaffold-manifest.json"
  git -C "$WS" show HEAD:scaffold-manifest.json | diff -u - "$d/scaffold-manifest.json" > "$EV/AC-08/$1.manifest.diff"
  ev_run AC-08 "checker-$1" -- node "$SK/scripts/check-manifest.mjs" "$d/scaffold-manifest.json"
}
mkdir -p "$WORK/ac08-control"; git -C "$WS" archive HEAD | tar -x -C "$WORK/ac08-control"
ev_run AC-08 checker-untouched -- node "$SK/scripts/check-manifest.mjs" "$WORK/ac08-control/scaffold-manifest.json"; cu=$?
tamper g09-empty '.gates.G09.status="passed" | .gates.G09.evidence=[]'; c1=$(cat "$EV/AC-08/checker-g09-empty.exit")
tamper g09-with-evidence '.gates.G09.status="passed" | .gates.G09.evidence=["local-only"]'; c2=$(cat "$EV/AC-08/checker-g09-with-evidence.exit")
tamper g01-empty '.gates.G01.status="passed" | .gates.G01.evidence=[]'; c3=$(cat "$EV/AC-08/checker-g01-empty.exit")
ev_run AC-08 claims-grep -- bash -c "git ls-files -z -- '*.md' | xargs -0 grep -niE 'production[- ]ready|deployment[ -]verified|certified' || true"
claims="$(grep -c . "$EV/AC-08/claims-grep.stdout")"
if [ $fields_ok = 1 ] && [ $cu = 0 ] && [ "$c1" != 0 ] && [ "$c2" != 0 ] && [ "$c3" != 0 ] && [ "$claims" = 0 ]; then
  verdict AC-08 PASS "generated/unverified/not integrated; all gates and requirements not_run; checker accepts the original and rejects G09 passed (empty and with evidence) and G01 passed with empty evidence; no readiness or verification claim in tracked text"
else
  verdict AC-08 FAIL "fieldsOk=$fields_ok untouchedChecker=$cu g09Empty=$c1 g09Evidence=$c2 g01Empty=$c3 claimMatches=$claims"
fi
