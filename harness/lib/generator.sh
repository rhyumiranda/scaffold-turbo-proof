# Helpers for the generator job (AC-01 .. AC-08).
SK="$HARNESS/skills/scaffold-turbo-nest-next"
GEN="$WORK/gen"
INTAKE="$WORK/intake.json"
NODE_IMAGE="node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c"
mkdir -p "$GEN" "$WORK/tmp"
# The intake from criteria section 0.2 rule 2, written verbatim.
printf '%s\n' '{"journey":"Owners create, list, read and rename their projects","actors":["signed-in owner"],"auth":"oidc","database":"postgresql","deletion":"none","deployment":"containers","optionalProfiles":[]}' > "$INTAKE"

# gen_run AC-NN label TMPDIR-dir -- generator args...   Runs the generator with its own empty TMPDIR.
gen_run() {
  local ac="$1" label="$2" tmp="$3"; shift 4
  mkdir -p "$tmp"
  EV_ENV_NAMES=TMPDIR ev_run "$ac" "$label" -- env TMPDIR="$tmp" node "$SK/scripts/scaffold.mjs" "$@"
}

# dir_state DIR   Prints a stable listing plus a SHA-256 of every file (byte-identity check).
dir_state() {
  ( cd "$1" && { find . -print | LC_ALL=C sort; find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum; } )
}

# tapnum FILE KEY   Last "ℹ KEY N" (or "# KEY N") summary number from a node:test run.
tapnum() { grep -E "^(ℹ|#) $2 [0-9]+" "$1" | tail -1 | awk '{print $3}'; }

# manifest_checksums_ok DIR   Every checksum in scaffold-manifest.json matches its file; no file is missing from the manifest.
manifest_checksums_ok() {
  local dir="$1" bad=0 n=0 unlisted
  while IFS=$'\t' read -r f h; do
    n=$((n+1))
    a="$(sha256sum "$dir/$f" 2>/dev/null | cut -d' ' -f1)"
    [ "$a" = "$h" ] || { echo "MISMATCH $f"; bad=$((bad+1)); }
  done < <(jq -r '.checksums | to_entries[] | "\(.key)\t\(.value)"' "$dir/scaffold-manifest.json")
  unlisted="$(comm -23 <(cd "$dir" && find . -type f ! -name scaffold-manifest.json ! -path './.git/*' | sed 's|^\./||' | LC_ALL=C sort) <(jq -r '.checksums | keys[]' "$dir/scaffold-manifest.json" | LC_ALL=C sort))"
  echo "manifest entries: $n mismatches: $bad"
  echo "files on disk not in manifest: $(printf '%s' "$unlisted" | grep -c .)"
  [ -z "$unlisted" ] || printf '%s\n' "$unlisted"
  [ "$bad" -eq 0 ] && [ -z "$unlisted" ] && [ "$n" -gt 0 ]
}
