#!/bin/bash
# AC-26 hostile requests carrying sentinels. env: S_A S_B S_C S_D TOKEN API_URL WEB_URL
r() { echo "### $*" | sed -E 's/(SENTINEL|eyJ)[^ "]*/<value>/g'; curl -s -o /dev/null -m 15 -w 'status=%{http_code}\n' "$@"; }
r -H "Authorization: Bearer $S_A" "$API_URL/v1/projects"
r -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' --data "{\"name\":\"x\",\"password\":\"$S_D\"}" "$API_URL/v1/projects"
r -X POST -H 'content-type: application/json' --data "{\"password\":\"$S_D\"}" "$API_URL/v1/projects"
r -H "Cookie: __Host-app_session=$S_B" "$WEB_URL/projects"
r -H "Cookie: app_session=$S_B" "$WEB_URL/projects"
r -H "Cookie: app_session=$S_B" -H "Authorization: Bearer $S_A" "$WEB_URL/projects/00000000-0000-4000-8000-000000000000"
r "$WEB_URL/auth/callback?code=$S_C&state=x"
r -H "Cookie: oidc_transaction=$S_B" "$WEB_URL/auth/callback?code=$S_C&state=x"
r -X POST -H "origin: $WEB_URL" -H "Cookie: app_session=$S_B" -H 'content-type: application/json' --data "{\"password\":\"$S_D\"}" "$WEB_URL/auth/refresh"
r -X POST -H 'content-type: application/x-www-form-urlencoded' -H "Cookie: app_session=$S_B" --data "password=$S_D" "$WEB_URL/projects"
