#!/bin/bash
# usage: jqlines.sh file...   Each non-empty line must parse as JSON (jq -e . per line). Prints counts; exit 1 on any failure.
bad=0
for f in "$@"; do
  total=0; fail=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    total=$((total + 1))
    printf '%s' "$line" | jq -e 'type=="object"' > /dev/null 2>&1 || fail=$((fail + 1))
  done < "$f"
  echo "$(basename "$f"): $total lines, $fail not a JSON object"; bad=$((bad + fail))
done
[ "$bad" = 0 ]
