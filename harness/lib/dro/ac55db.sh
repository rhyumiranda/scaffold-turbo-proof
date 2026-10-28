#!/bin/bash
# usage: ac55db.sh <outfile> <project-id>   env: TOKEN API_URL. Four requests while PostgreSQL stalls; prints "label status seconds".
P="$2"; : > "$1"
r() { curl -s -m 40 -o /dev/null -w "$1 %{http_code} %{time_total}\n" "${@:2}" >> "$1.tmp"; }
t() { local label="$1"; shift; curl -s -m 40 -o /dev/null -w "$label %{http_code} %{time_total}\n" -H "authorization: Bearer $TOKEN" "$@" >> "$OUTF"; }
OUTF="$1"
t list "$API_URL/v1/projects?limit=5" &
t read "$API_URL/v1/projects/$P" &
t create -X POST -H 'content-type: application/json' -d '{"name":"AC55 db stall"}' "$API_URL/v1/projects" &
t rename -X PATCH -H 'content-type: application/json' -d '{"name":"AC55 db stall renamed","expectedVersion":1}' "$API_URL/v1/projects/$P" &
wait
