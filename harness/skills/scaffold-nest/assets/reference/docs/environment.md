# API environment reference

Every variable the API reads. The process validates them before it listens and exits with an error that names the variable, never its value. Values marked secret come from a secret store, never from source control or image layers.

| Variable | Required | Default | Secret | Purpose |
|---|---|---|---|---|
| `DATABASE_URL` | yes | — | yes | PostgreSQL connection URL (`postgres:` or `postgresql:`). Contains the database password. An optional `?schema=<name>` selects a PostgreSQL schema other than `public`, for the API and for migrations alike. |
| `AUTH_ISSUER` | yes | — | no | OIDC issuer identifier; must equal the token `iss`. `https:` required (plain `http:` only with `NODE_ENV=test` on loopback). |
| `AUTH_AUDIENCE` | yes | — | no | Expected token `aud` for this API. Tokens for other audiences get 401. |
| `AUTH_JWKS_URL` | yes | — | no | Provider signing-key endpoint. Same HTTPS rule as `AUTH_ISSUER`. |
| `AUTH_JWKS_COOLDOWN_MS` | no | `30000` | no | Minimum time between key refetches when an unknown `kid` arrives (1–600000). |
| `AUTH_JWKS_CACHE_MS` | no | `600000` | no | How long fetched keys are trusted before refetch (1–3600000). |
| `PORT` | no | `4100` | no | Listen port (1–65535). |
| `NODE_ENV` | no | — | no | `production` in deployments; `test` only for test suites. |
| `SHUTDOWN_TIMEOUT_MS` | no | `8000` | no | SIGTERM drain deadline before a forced exit (100–30000). |
| `MAX_IN_FLIGHT` | no | `100` | no | Concurrent requests before new ones get 503 + `Retry-After` (1–10000). |
| `RATE_LIMIT` | no | `100` | no | Requests per window per verified user (per IP when unauthenticated) (1–100000). |
| `RATE_WINDOW_MS` | no | `60000` | no | Rate-limit window (1–3600000). |
| `LIMITER_MODE` | no | `memory` | no | `memory` (single instance) or `redis` (quota shared by all replicas). |
| `LIMITER_REDIS_URL` | when `LIMITER_MODE=redis` | — | yes | Shared limiter store. `rediss:` required except on loopback. May contain a password. |
| `LIMITER_NAMESPACE` | no | `api` | no | Key prefix in the shared limiter store; unique per environment. |
| `TRUST_PROXY_CIDRS` | no | empty | no | Comma-separated IPs/CIDRs of your load balancers. Empty means forwarded headers are ignored. |
| `WEB_ORIGIN` | no | unset | no | Enables CORS for exactly this origin, without credentials. Leave unset for server-to-server use. |
| `TELEMETRY_EXPORTER` | no | `none` | no | `none` (JSON logs only), `otlp` (export traces/metrics), `console` (local debugging, not JSON). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | when `TELEMETRY_EXPORTER=otlp` | — | no | Collector URL. `https:` except on loopback; no credentials in the URL. |
| `OTEL_SERVICE_NAME` | no | `api` | no | `service` field in logs and `service.name` in telemetry. |

The migration job (`scripts/migrate.mjs`, which runs `prisma migrate deploy`) reads `DATABASE_URL`; give it a migration-only credential. The migrate image also sets `PRISMA_SCHEMA_ENGINE_BINARY` to the schema engine it carries, so it never downloads anything. Runtime Prisma commands use `prisma.config.ts`; builds use `prisma.generate.config.ts`, because client generation needs no database and must not vary with a runtime credential.
