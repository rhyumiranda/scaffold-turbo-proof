#!/bin/bash
. "$(dirname "$0")/env.sh"
TOK=$(curl -s -X POST http://localhost:8080/realms/acme-z5/protocol/openid-connect/token -d grant_type=password -d client_id=acme-cli --data-urlencode "client_secret=$ACME_CLI_SECRET" -d username=alice --data-urlencode "password=$ALICE_PASSWORD" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
A=http://127.0.0.1:4103
for o in https://evil.example http://localhost:3000 null; do
  echo "--- OPTIONS /v1/projects Origin: $o (Access-Control-Request-Method: POST, Request-Headers authorization,content-type)"
  curl -s -D - -o /dev/null -X OPTIONS -H "Origin: $o" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type' $A/v1/projects | grep -iE '^HTTP|access-control|vary'
  echo "--- GET /health/live Origin: $o"; curl -s -D - -o /dev/null -H "Origin: $o" $A/health/live | grep -iE '^HTTP|access-control|vary'
  echo "--- GET /v1/projects (alice token) Origin: $o"; curl -s -D - -o /dev/null -H "Origin: $o" -H "Authorization: Bearer $TOK" $A/v1/projects | grep -iE '^HTTP|access-control|vary'
  echo "--- POST /v1/projects 401 path no token Origin: $o"; curl -s -D - -o /dev/null -X POST -H "Origin: $o" -H 'content-type: application/json' -d '{"name":"x"}' $A/v1/projects | grep -iE '^HTTP|access-control|vary'
done
