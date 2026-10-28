# Web environment reference

Every variable the web app reads. `scripts/start.mjs` and `scripts/container-start.mjs` validate them before the port opens and exit with an error that names the variable, never its value. Values marked secret come from a secret store, never from source control.

| Variable | Required | Default | Secret | Purpose |
|---|---|---|---|---|
| `API_BASE_URL` | yes | — | no | API origin for server-side calls. `https:` except on loopback; origin only, no path. |
| `AUTH_MODE` | no | `external-cookie` | no | `external-cookie` (another system issues the `api_session` cookie) or `oidc` (this app signs users in). |
| `AUTH_APP_ORIGIN` | with `oidc` | — | no | Exact public origin of this app, used for callbacks and the CSRF origin check. `https:` required. |
| `AUTH_ISSUER` | with `oidc` | — | no | OIDC issuer identifier (not the discovery URL). `https:` required. |
| `AUTH_CLIENT_ID` | with `oidc` | — | no | OIDC client id registered with the provider. |
| `AUTH_CLIENT_SECRET` | with a confidential client | — | yes | OIDC client secret. Omit for a public PKCE client. |
| `AUTH_SCOPE` | no | `openid` | no | Requested scopes; must include `openid`. Add what your API audience needs. |
| `AUTH_REDIS_URL` | with `oidc` | — | yes | Server-side session store (signed-in sessions only; starting a sign-in writes nothing to it). `rediss:` required except on loopback. May contain a password. |
| `AUTH_TRANSACTION_SECRET` | with `oidc` | — | yes | Key material for the encrypted sign-in transaction cookie (AES-256-GCM, key derived with HKDF-SHA256). Unpadded base64url of at least 32 random bytes, for example from `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Every replica needs the same value. Rotating it makes sign-ins in progress restart; signed-in sessions are unaffected. |
| `AUTH_NAMESPACE` | no | `web` | no | Key prefix in the session store; unique per app and environment. |
| `AUTH_SESSION_SECONDS` | no | `3600` | no | Absolute session lifetime (60–86400). Refresh never extends it. |
| `AUTH_INSECURE_LOOPBACK` | no | unset | no | `true` allows plain `http:` origin, issuer and Redis only when all three are loopback. Local development only. |
| `SHUTDOWN_TIMEOUT_MS` | no | `8000` | no | SIGTERM drain deadline before a forced exit. |
| `NODE_ENV` | no | — | no | `production` in deployments. |
| `NEXT_RUNTIME` | no (set by Next.js) | `nodejs` in the Node server, `edge` in the Edge runtime; unset outside Next.js | no | Selects server instrumentation. Identity checks and telemetry registration run only in the Node server. Do not configure it. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | unset | no | Enables trace/metric export to this collector. `https:` except on loopback. |
| `OTEL_SERVICE_NAME` | no | `api-backed-web` | no | `service.name` in exported telemetry. |

Build-time only (read by `next.config.ts` during `next build`, baked into the server bundle):

| Variable | Required | Default | Secret | Purpose |
|---|---|---|---|---|
| `DEPLOYMENT_REPLICAS` | no | `1` | no | More than 1 requires the two values below at build time. |
| `APP_DEPLOYMENT_ID` | with replicas > 1 | — | no | Same value on every replica of one release; enables version-skew protection. |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | with replicas > 1 | — | yes | Shared Server Action key (base64, 16/24/32 bytes). Embedded in the built server bundle, so the image is secret-bearing: restrict registry pull access. Pass it as a BuildKit secret, never a build arg. |

`NEXT_RUNTIME` and `NEXT_MANUAL_SIG_HANDLE` are set by Next.js and the start script; do not configure them. No `NEXT_PUBLIC_*` variables are used. Adding one requires listing it in `public-env.json` (checked by `pnpm check:arch`) because its value is inlined into the browser bundle.
