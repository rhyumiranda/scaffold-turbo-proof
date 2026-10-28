#!/bin/bash
# usage: ac51-latency.sh <outdir> <phase>   env: TOKEN API_URL.
#   phase warm : 20 requests so the pool holds open connections.   phase burst : 50 concurrent requests, each timed.
out="$1"; mkdir -p "$out"
if [ "$2" = warm ]; then
  seq 1 20 | xargs -P 10 -I{} curl -s -o /dev/null -H "authorization: Bearer $TOKEN" "$API_URL/v1/projects?limit=5"
else
  export out
  seq 1 50 | xargs -P 50 -I{} sh -c 'curl -s -m 30 -o "$out/body-{}.json" -w "{} %{http_code} %{time_total}\n" -H "authorization: Bearer $TOKEN" "$API_URL/v1/projects?limit=5"' > "$out/latency-50.txt"
fi
