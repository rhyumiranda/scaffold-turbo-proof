#!/bin/bash
# usage: pgsample.sh <out> <seconds> <db>   One sample per second: epoch, connections to <db>, of which the API's. Read-only. Needs PGC.
out="$1"; end=$(( $(date +%s) + $2 )); : > "$out"
while [ "$(date +%s)" -lt "$end" ]; do
  t="$(date +%s.%N)"
  c="$(docker exec "$PGC" psql -U postgres -d postgres -At -F ' ' -c "SELECT count(*), count(*) FILTER (WHERE application_name='nest-reference') FROM pg_stat_activity WHERE datname='$3'" 2>&1)"
  echo "$t $c" >> "$out"; sleep 1
done
