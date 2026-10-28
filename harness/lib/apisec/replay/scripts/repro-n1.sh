#!/bin/bash
# z5 round 2l: minimal repros (curl only, NO cookie, NO login) against the production web on :3103
U=http://localhost:3103
t() { LABEL=$1; shift; code=$(curl -s -o "$PZ/run/o.txt" -w '%{http_code}' --path-as-is "$@"); printf '%-62s HTTP %s  %s\n' "$LABEL" "$code" "$(head -c 60 "$PZ/run/o.txt" | tr '\r\n' '  ')"; }
echo "# control (blocked by the wrapper)"; t "GET /_global-error" "$U/_global-error"
echo "# /_global-error reached through a spelling the wrapper's exact match does not catch (curl --path-as-is, no cookie)"
for p in '/./_global-error' '/x/../_global-error' '/%2e/_global-error' '/%2E%2E/_global-error' '/projects/../_global-error' '/%5Fglobal-error' '/_global%2Derror' '/_global-error/' '/_global-error.rsc' '//_global-error' '/_global-error/.'; do
  t "GET $p" "$U$p"; t "HEAD $p" -I "$U$p"; t "GET $p RSC:1" -H 'RSC: 1' "$U$p"; done
