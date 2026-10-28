# shellcheck shell=bash disable=SC2034
# Helpers for the contract job (AC-27, AC-29, AC-30, AC-44, AC-45).
OSV_IMAGE="ghcr.io/google/osv-scanner:v2.7.0@sha256:4f3b7e2c64b9d38a5febc5a7e4a3dfef1d1362f726dea7a2ef4762b46469fcd0"
OASDIFF_IMAGE="tufin/oasdiff:v1.34.1@sha256:67a23cfea7d251e2ae34ee703ac8733c5d96bc2e7b90fd0f4d475ec99367b85f"
SCHEMATHESIS_IMAGE="schemathesis/schemathesis:4.32.5@sha256:e414b3466a95d03fc6d9de1b7842e1d4738775493750166035b943c0bdcce248"
SEMGREP_IMAGE="semgrep/semgrep:1.182.1@sha256:451b3d875c00dac7ed5db5293e584a07de11449a409c10b3c2d2652f429630b6"
restore_main() {
  git -C "$WS" reset -q --hard "$TARGET_SHA"
  git -C "$WS" clean -fdq
  git -C "$WS" switch -q --detach "$TARGET_SHA" || { echo "FATAL: cannot return to $TARGET_SHA"; exit 1; }
  [ "$(git -C "$WS" rev-parse HEAD)" = "$TARGET_SHA" ] || { echo "FATAL: HEAD is not the target commit"; exit 1; }
  git -C "$WS" for-each-ref --format='%(refname:short)' 'refs/heads/throwaway/*' | while read -r b; do git -C "$WS" branch -q -D "$b"; done
}
neg_start() { restore_main; git -C "$WS" switch -q -c "throwaway/$1-$2"; }
fixture_diff() { ev_run "$1" "$2-diff" -- bash -c 'git add -N . && git diff'; }
infra_down() { ( cd "$HARNESS/infra" && docker compose down -v --remove-orphans ) >/dev/null 2>&1 || true; }
