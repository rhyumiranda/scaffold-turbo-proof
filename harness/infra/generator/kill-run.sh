#!/bin/bash
# kill-run.sh DEST   Starts a generation (env SK, INTAKE, TMPDIR) and sends SIGKILL as soon as DEST/apps exists.
DEST="$1"
node "$SK/scripts/scaffold.mjs" --destination "$DEST" --name acme-app --intake "$INTAKE" > "$DEST.gen.out" 2> "$DEST.gen.err" &
pid=$!
echo "started pid $pid at $(date -u +%T.%N)"
killed=0
while kill -0 "$pid" 2>/dev/null; do
  if [ -d "$DEST/apps" ]; then
    kill -9 "$pid" 2>/dev/null && { killed=1; echo "SIGKILL sent at $(date -u +%T.%N) after apps/ appeared"; }
    break
  fi
done
wait "$pid" 2>/dev/null; echo "generator exit status: $? killed=$killed"
