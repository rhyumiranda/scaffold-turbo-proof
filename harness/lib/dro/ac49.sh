#!/bin/bash
# usage: ac49.sh <outdir>   env: TOKEN API_URL.  alice creates P, then 50 parallel renames carry the same expectedVersion.
out="$1"; mkdir -p "$out/resp"
created="$(curl -sS -X POST "$API_URL/v1/projects" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"name":"AC49 contested"}')"
echo "$created" > "$out/create.json"
P="$(echo "$created" | jq -r .id)"; echo "$P" > "$out/project-id.txt"
export P out
seq 1 50 | xargs -P 50 -I{} sh -c 'curl -sS -o "$out/resp/{}.json" -w "{} %{http_code}\n" -X PATCH "$API_URL/v1/projects/$P" -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d "{\"name\":\"contender-{}\",\"expectedVersion\":1}"' > "$out/statuses.txt"
awk '{print $2}' "$out/statuses.txt" | sort | uniq -c | sort -rn > "$out/histogram.txt"
cat "$out/histogram.txt"
