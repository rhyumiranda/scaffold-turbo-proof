# Container-stack helpers shared by the images, ops and deferred jobs. Source after common.sh.
# Topology (all on Docker network acc-net): Postgres, TLS-only Redis, Keycloak (realm acme, frontend URL
# https://id.acme.test:8443), a Caddy TLS edge (throwaway CA) in front of Keycloak, web and API, then the
# application containers run with the hardened flags the criteria name.
# Every image is pinned by tag and digest.
IMG_PG="postgres:15.15@sha256:98fe06b500b5eb29e45bf8c073eb0ca399790ce17b1d586448edc4203627d342"
IMG_REDIS="redis:8.2.2@sha256:4521b581dbddea6e7d81f8fe95ede93f5648aaa66a9dacd581611bf6fe7527bd"
IMG_KC="quay.io/keycloak/keycloak:26.4@sha256:9409c59bdfb65dbffa20b11e6f18b8abb9281d480c7ca402f51ed3d5977e6007"
IMG_CADDY="caddy:2.10.2@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb"
IMG_HADOLINT="hadolint/hadolint:v2.14.0@sha256:27086352fd5e1907ea2b934eb1023f217c5ae087992eb59fde121dce9c9ff21e"
IMG_TRIVY="aquasec/trivy:0.67.2@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08"
IMG_K6="grafana/k6:1.3.0@sha256:3ddc8b1a33a2c3d8edc6e99b6a762ae36cba08788463458f5e6a7703e14eb77d"
IMG_OTEL="otel/opentelemetry-collector-contrib:0.139.0@sha256:faf125d656fa47cea568b2f3b4494efd2525083bc75c1e96038bc23f05cd68fd"
IMG_REGISTRY="registry:3.0.0@sha256:6c5666b861f3505b116bb9aa9b25175e71210414bd010d92035ff64018f9457e"
IMG_SYFT="anchore/syft:v1.55.0@sha256:4cc92b64ca74ffca4c94d4c8fcc01f217731375300be14d0b6eeb2e82eaa110a"

CT="$WORK/ct"                       # private runtime files (certs, env files); never uploaded as evidence
CT_NET=acc-net
CT_HARD=(--read-only --cap-drop ALL --security-opt no-new-privileges --cpus=2 --memory=2g)
IDP_ORIGIN=https://id.acme.test:8443
APP_ORIGIN=https://app.acme.test:8443
API_PUBLIC=https://api.acme.test:8443
KC_LOCAL=http://127.0.0.1:18080     # Keycloak's own port, used only to mint tokens from the host
export CT CT_NET

ct_log() { echo "[$(date -u +%T)] $*"; }

# Throwaway CA and one server certificate for every name the stack uses.
ct_certs() {
  local d="$CT/certs"; mkdir -p "$d"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$d/ca.key" -out "$d/ca.crt" -days 2 -subj "/CN=acc-test-ca" || return 1
  cat > "$d/ext.cnf" <<'X'
subjectAltName=DNS:app.acme.test,DNS:id.acme.test,DNS:api.acme.test,DNS:acc-redis,DNS:localhost,IP:127.0.0.1
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
X
  openssl req -newkey rsa:2048 -nodes -keyout "$d/site.key" -out "$d/site.csr" -subj "/CN=app.acme.test" || return 1
  openssl x509 -req -in "$d/site.csr" -CA "$d/ca.crt" -CAkey "$d/ca.key" -CAcreateserial -out "$d/site.crt" -days 2 -extfile "$d/ext.cnf" || return 1
  chmod 644 "$d"/*   # throwaway test keys; containers run as other uids
}

ct_hosts() { echo "127.0.0.1 app.acme.test id.acme.test api.acme.test" | sudo tee -a /etc/hosts; }

ct_pg_up() {
  docker network inspect "$CT_NET" > /dev/null 2>&1 || docker network create "$CT_NET" || return 1
  POSTGRES_PASSWORD="$PG_PASSWORD" docker run -d --name acc-pg --network "$CT_NET" --cpus=2 --memory=2g --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_PASSWORD -p 127.0.0.1:5432:5432 "$IMG_PG" \
    postgres -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=200 || return 1
  local i; for i in $(seq 1 90); do docker exec acc-pg pg_isready -U postgres > /dev/null 2>&1 && return 0; sleep 1; done
  docker logs acc-pg | tail -20; return 1
}

# Passwordless login for the documented example URL postgresql://test_user@127.0.0.1:5432/test_database
# (apps/web/docs/testing.md). Rule goes first in pg_hba.conf; the role exists only in this throwaway cluster.
ct_pg_test_user() {
  docker exec acc-pg sh -c "sed -i '1i host all test_user all trust' /var/lib/postgresql/data/pg_hba.conf" || return 1
  docker exec acc-pg psql -U postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE test_user LOGIN SUPERUSER" -c "CREATE DATABASE test_database OWNER test_user" -c "SELECT pg_reload_conf()" || return 1
}

ct_db_create() { docker exec acc-pg createdb -U postgres "$1"; }

ct_redis_tls_up() {
  docker run -d --name acc-redis --network "$CT_NET" --cpus=1 --memory=1g -v "$CT/certs:/certs:ro" "$IMG_REDIS" \
    redis-server --port 0 --tls-port 6380 --tls-cert-file /certs/site.crt --tls-key-file /certs/site.key \
    --tls-ca-cert-file /certs/ca.crt --tls-auth-clients no --save "" --appendonly no || return 1
  local i; for i in $(seq 1 30); do docker exec acc-redis redis-cli --tls --cacert /certs/ca.crt -p 6380 ping 2> /dev/null | grep -q PONG && return 0; sleep 1; done
  docker logs acc-redis | tail; return 1
}

# Plain loopback Redis for the generated test suites (TEST_REDIS_URL), as in the generated CI.
ct_redis_plain_up() {
  docker run -d --name acc-redis-plain --cpus=1 --memory=1g -p 127.0.0.1:6379:6379 "$IMG_REDIS" redis-server --save "" --appendonly no || return 1
  local i; for i in $(seq 1 30); do docker exec acc-redis-plain redis-cli ping 2> /dev/null | grep -q PONG && return 0; sleep 1; done; return 1
}

ct_kc_up() {
  mkdir -p "$CT/realm"
  jq --arg f "$IDP_ORIGIN" '.attributes = ((.attributes // {}) + {frontendUrl: $f})' "$HARNESS/infra/realm/acme.json" > "$CT/realm/acme.json" || return 1
  chmod 644 "$CT/realm/acme.json"
  KC_BOOTSTRAP_ADMIN_USERNAME=admin KC_BOOTSTRAP_ADMIN_PASSWORD="$KC_ADMIN_PASSWORD" \
  docker run -d --name acc-kc --network "$CT_NET" --cpus=2 --memory=2g -p 127.0.0.1:18080:8080 \
    -e KC_BOOTSTRAP_ADMIN_USERNAME -e KC_BOOTSTRAP_ADMIN_PASSWORD \
    -e KC_USER_PASSWORD -e KC_ACME_WEB_SECRET -e KC_ACME_CLI_SECRET -e KC_ACME_NOAUD_SECRET -e KC_OTHER_CLI_SECRET \
    -v "$CT/realm:/opt/keycloak/data/import:ro" "$IMG_KC" start-dev --import-realm --http-port 8080 --health-enabled=true || return 1
  local i; for i in $(seq 1 150); do
    curl -fs "$KC_LOCAL/realms/acme/.well-known/openid-configuration" -o "$CT/discovery.json" 2> /dev/null && break; sleep 2
  done
  [ -s "$CT/discovery.json" ] || { docker logs acc-kc | tail -30; return 1; }
  jq -e --arg i "$IDP_ORIGIN/realms/acme" '.issuer == $i' "$CT/discovery.json" > /dev/null || { echo "issuer is not the frontend URL"; jq .issuer "$CT/discovery.json"; return 1; }
}

ct_caddy_up() {
  cat > "$CT/Caddyfile" <<'X'
{
	auto_https disable_redirects
	admin off
}
https://id.acme.test:8443 {
	tls /certs/site.crt /certs/site.key
	reverse_proxy acc-kc:8080
}
https://app.acme.test:8443 {
	tls /certs/site.crt /certs/site.key
	reverse_proxy acc-web:3000
}
https://api.acme.test:8443 {
	tls /certs/site.crt /certs/site.key
	reverse_proxy acc-api:4100
}
X
  docker rm -f acc-caddy > /dev/null 2>&1
  docker run -d --name acc-caddy --network "$CT_NET" --network-alias id.acme.test --network-alias app.acme.test --network-alias api.acme.test \
    --cpus=2 --memory=1g -v "$CT/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$CT/certs:/certs:ro" -p 127.0.0.1:8443:8443 "$IMG_CADDY" || return 1
  local i; for i in $(seq 1 30); do
    curl -fs --cacert "$CT/certs/ca.crt" "$IDP_ORIGIN/realms/acme/.well-known/openid-configuration" > /dev/null 2>&1 && return 0; sleep 1
  done
  docker logs acc-caddy | tail; return 1
}

# Plain Keycloak-less pieces (pg, redis, plain redis) plus Keycloak and the edge. $1 = "full" (default) or "nokc".
ct_stack_up() {
  ct_certs || return 1
  ct_hosts > /dev/null || return 1
  ct_pg_up || return 1
  ct_redis_tls_up || return 1
  [ "${1:-full}" = nokc ] && return 0
  ct_kc_up || return 1
  ct_caddy_up || return 1
}

# Env files for the three runtime images against database $1. Extra API lines come from CT_API_EXTRA (newline list).
ct_envfiles() {
  local db="$1"; mkdir -p "$CT/env"; umask 077
  printf 'DATABASE_URL=postgresql://postgres:%s@acc-pg:5432/%s\n' "$PG_PASSWORD" "$db" > "$CT/env/migrate.env"
  {
    printf 'DATABASE_URL=postgresql://postgres:%s@acc-pg:5432/%s\n' "$PG_PASSWORD" "$db"
    echo "AUTH_ISSUER=$IDP_ORIGIN/realms/acme"
    echo "AUTH_AUDIENCE=acme-api"
    echo "AUTH_JWKS_URL=$IDP_ORIGIN/realms/acme/protocol/openid-connect/certs"
    echo "NODE_EXTRA_CA_CERTS=/etc/acc-ca/ca.crt"
    [ -n "${CT_API_EXTRA:-}" ] && printf '%s\n' "$CT_API_EXTRA"
  } > "$CT/env/api.env"
  {
    echo "API_BASE_URL=$API_PUBLIC"
    echo "AUTH_MODE=oidc"
    echo "AUTH_APP_ORIGIN=$APP_ORIGIN"
    echo "AUTH_ISSUER=$IDP_ORIGIN/realms/acme"
    echo "AUTH_CLIENT_ID=acme-web"
    echo "AUTH_CLIENT_SECRET=$KC_ACME_WEB_SECRET"
    echo "AUTH_REDIS_URL=rediss://acc-redis:6380"
    echo "AUTH_NAMESPACE=acc-web"
    echo "NODE_EXTRA_CA_CERTS=/etc/acc-ca/ca.crt"
  } > "$CT/env/web.env"
  umask 022
  echo "env files for database $db; names: migrate[$(cut -d= -f1 "$CT/env/migrate.env" | tr '\n' ' ')] api[$(cut -d= -f1 "$CT/env/api.env" | tr '\n' ' ')] web[$(cut -d= -f1 "$CT/env/web.env" | tr '\n' ' ')]"
}

ct_migrate() { docker run --rm --name acc-migrate --network "$CT_NET" "${CT_HARD[@]}" --env-file "$CT/env/migrate.env" "$1"; }

# ct_api_up IMAGE [extra docker run args]   starts acc-api hardened, published on 127.0.0.1:4100, waits for ready
ct_api_up() {
  local img="$1"; shift
  docker rm -f acc-api > /dev/null 2>&1
  docker run -d --name acc-api --network "$CT_NET" "${CT_HARD[@]}" -v "$CT/certs/ca.crt:/etc/acc-ca/ca.crt:ro" \
    --env-file "$CT/env/api.env" -p 127.0.0.1:4100:4100 "$@" "$img" > /dev/null || return 1
  local i c; for i in $(seq 1 120); do
    c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4100/health/ready); [ "$c" = 200 ] && { echo "api ready after ~$((i / 2))s"; return 0; }; sleep 0.5
  done
  echo "api not ready (last status $c)"; docker logs acc-api | tail -20; return 1
}

ct_web_up() {
  local img="$1"; shift
  docker rm -f acc-web > /dev/null 2>&1
  docker run -d --name acc-web --network "$CT_NET" "${CT_HARD[@]}" -v "$CT/certs/ca.crt:/etc/acc-ca/ca.crt:ro" \
    --env-file "$CT/env/web.env" -p 127.0.0.1:3000:3000 "$@" "$img" > /dev/null || return 1
  local i c; for i in $(seq 1 120); do
    c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/healthz); [ "$c" = 200 ] && { echo "web healthz 200 after ~$((i / 2))s"; return 0; }; sleep 0.5
  done
  echo "web not healthy (last status $c)"; docker logs acc-web | tail -20; return 1
}

# ct_token USER -> access token on stdout (never log it)
ct_token() {
  curl -fs "$KC_LOCAL/realms/acme/protocol/openid-connect/token" -d grant_type=password -d client_id=acme-cli \
    --data-urlencode "client_secret=$KC_ACME_CLI_SECRET" -d "username=$1" --data-urlencode "password=$KC_USER_PASSWORD" -d scope=openid | jq -r .access_token
}

# ct_exercise BASE LABEL USER   list, create, read, rename through the API; prints status codes only
ct_exercise() {
  local base="$1" label="$2" tok r c body id ver fail=0
  tok="$(ct_token "${3:-alice}")" || return 1
  [ -n "$tok" ] && [ "$tok" != null ] || { echo "no token"; return 1; }
  r=$(curl -s -w '\n%{http_code}' "$base/v1/projects?limit=20" -H "authorization: Bearer $tok"); c=${r##*$'\n'}; echo "list: $c"; [ "$c" = 200 ] || fail=1
  r=$(curl -s -w '\n%{http_code}' -X POST "$base/v1/projects" -H "authorization: Bearer $tok" -H 'content-type: application/json' -d "{\"name\":\"$label created\"}")
  c=${r##*$'\n'}; body=${r%$'\n'*}; echo "create: $c"; [ "$c" = 201 ] || fail=1
  id=$(jq -r .id <<< "$body"); ver=$(jq -r .version <<< "$body")
  r=$(curl -s -w '\n%{http_code}' "$base/v1/projects/$id" -H "authorization: Bearer $tok"); c=${r##*$'\n'}; echo "read: $c"; [ "$c" = 200 ] || fail=1
  r=$(curl -s -w '\n%{http_code}' -X PATCH "$base/v1/projects/$id" -H "authorization: Bearer $tok" -H 'content-type: application/json' -d "{\"name\":\"$label renamed\",\"expectedVersion\":$ver}")
  c=${r##*$'\n'}; echo "rename: $c"; [ "$c" = 200 ] || fail=1
  echo "exercise $label fail=$fail"; return $fail
}

# ct_journey LABEL OUTDIR [rename]   real Chromium: sign in at Keycloak, create (and rename) a project, reload
ct_journey() {
  local label="$1" out="$2"
  WS="$WS" BASE="$APP_ORIGIN" OUT="$out" NAME="$label $(date +%s)" KC_USER="${KC_USER:-alice}" KC_PASS="$KC_USER_PASSWORD" RENAME="${3:-}" \
    node "$HARNESS/infra/images/journey.mjs"
}

# Replace every generated secret value found in evidence files with a marker (belt and braces).
ct_redact() {
  local k v f
  [ -f "$WORK/.secrets" ] || return 0
  while IFS='=' read -r k v; do
    [ "${#v}" -ge 8 ] || continue
    grep -rlaF -- "$v" "$EV" "$RES" 2> /dev/null | while read -r f; do sed -i "s/$v/<redacted:$k>/g" "$f"; echo "redacted $k in ${f#$WORK/}"; done
  done < "$WORK/.secrets"
}

# ct_elapsed CONTAINER -> seconds between StartedAt and FinishedAt (or "running")
ct_elapsed() {
  docker inspect -f '{{.State.StartedAt}} {{.State.FinishedAt}}' "$1" | python3 -c '
import sys, re, datetime as d
a, b = sys.stdin.read().split()
if b.startswith("0001"): print("running"); sys.exit()
def p(s):
    m = re.match(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?Z", s)
    return d.datetime.fromisoformat(m.group(1) + (m.group(2) or ".0")[:7])
print(round((p(b) - p(a)).total_seconds(), 2))'
}

# ct_missing IMAGE ENVFILE VAR   start the container with VAR removed; print: image var exit elapsed_s names_var
ct_missing() {
  local img="$1" envf="$2" var="$3" name="acc-miss-$RANDOM" tmp i st code el named
  tmp="$(mktemp "$CT/env/miss.XXXXXX")"; grep -v "^$var=" "$envf" > "$tmp"
  docker run -d --name "$name" --network "$CT_NET" "${CT_HARD[@]}" -v "$CT/certs/ca.crt:/etc/acc-ca/ca.crt:ro" --env-file "$tmp" "$img" > /dev/null
  for i in $(seq 1 30); do st="$(docker inspect -f '{{.State.Status}}' "$name")"; [ "$st" = exited ] && break; sleep 0.5; done
  code="$(docker inspect -f '{{.State.ExitCode}}' "$name")"; el="$(ct_elapsed "$name")"
  if docker logs "$name" 2>&1 | grep -qF -- "$var"; then named=yes; else named=no; fi
  echo "--- log of $name (first lines)" >&2; docker logs "$name" 2>&1 | head -3 | cut -c1-300 >&2
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$img" "$var" "$st" "$code" "$el" "$named"
  docker rm -f "$name" > /dev/null; rm -f "$tmp"
}
