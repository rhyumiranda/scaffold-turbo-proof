#!/bin/bash
for hdr in "Origin: https://evil.example" "Sec-Fetch-Site: cross-site" "Origin: http://localhost:3103" "Origin: http://localhost:3103|Sec-Fetch-Site: same-origin" "Origin: http://localhost:3103|Sec-Fetch-Site: same-origin|Content-Length: 0"; do
  args=(); IFS='|' read -ra parts <<< "$hdr"; for p in "${parts[@]}"; do args+=(-H "$p"); done
  echo "POST /auth/logout [$hdr] (no cookie) -> $(curl -s -o /dev/null -w '%{http_code}' -X POST "${args[@]}" http://localhost:3103/auth/logout)"; done
echo "GET /auth/logout -> $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3103/auth/logout)"
