#!/bin/bash
# get-token.sh USER OUTFILE   Direct-grant access token for USER through acme-cli. Env: KC_ACME_CLI_SECRET, KC_USER_PASSWORD.
# Writes only the token to OUTFILE (mode 600); prints non-secret claims.
set -u
umask 077
resp="$(curl -sS -X POST http://localhost:8080/realms/acme/protocol/openid-connect/token -d grant_type=password -d client_id=acme-cli \
  --data-urlencode "client_secret=$KC_ACME_CLI_SECRET" -d "username=$1" --data-urlencode "password=$KC_USER_PASSWORD" -d scope=openid)"
token="$(printf '%s' "$resp" | jq -r '.access_token // empty')"
[ -n "$token" ] || { echo "no access token ($(printf '%s' "$resp" | jq -r '.error // "unknown"'))"; exit 1; }
printf '%s' "$token" > "$2"
payload="$(printf '%s' "$token" | cut -d. -f2 | tr '_-' '/+')"
printf 'token written; claims: '; printf '%s==' "$payload" | base64 -d 2>/dev/null | jq -c '{iss,aud,azp,preferred_username}'
