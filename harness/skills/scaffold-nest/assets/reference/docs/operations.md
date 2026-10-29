# Run and verify

Read [production profiles](production-profiles.md) for shared limiting, overload protection, key-rotation tests, container/export/load checks and the disposable restore exercise.

Select Node 24.22.1 / npm 11.17.0. Run `npm ci`, `npm run lint`, `npm run check:arch`, `npm run typecheck`, `npm run build`. `typecheck` and `build` run `prisma generate` first (the client is generated into `src/generated/prisma`, never committed). Installation scripts are disabled by .npmrc; explicitly approve any future package requiring one.

Set DATABASE_URL, AUTH_ISSUER, AUTH_AUDIENCE, AUTH_JWKS_URL without printing values. Validate the target before `npm run migrate`. It runs `scripts/migrate.mjs`: first it refuses (exit 1, naming the migration and the checksum mismatch) when an already-applied migration file was edited, then it applies `prisma/migrations/` with `prisma migrate deploy`. Concurrent runs are safe: Prisma holds a PostgreSQL advisory lock, and a run that waits too long exits 1 saying the lock is held. Because install scripts are disabled, the first run fetches Prisma's schema engine once with `prisma --version` (checksum-verified, from binaries.prisma.sh); images carry the engine instead. Never use `prisma migrate dev`, `prisma db push` or `prisma migrate reset`. Then `npm run contract`, `npm run contract:check`, `npm run contract:compat`, `npm start`. WEB_ORIGIN is optional and exact; bearer-token API transport does not use credentialed cookies. Choose trusted-proxy settings only from verified hosting topology, never blindly trust every proxy.

With a confirmed disposable database: `NODE_ENV=test npm run test:unit`, `NODE_ENV=test npm run test:integration`, `NODE_ENV=test npm run test:runtime`. The DB-backed scripts load `test/test-database.mjs` first, which refuses to run unless `NODE_ENV=test` and the database name ends in `_test`. Integration tests create synthetic records and per-test PostgreSQL schemas (`?schema=` in `DATABASE_URL`) migrated with `prisma migrate deploy`. They intentionally leave these in the disposable cluster rather than issue destructive teardown SQL. Never run them on shared/production data.

`test/with-web.mjs /absolute/web-project` supplies short-lived test identities for optional real browser integration. It is not production login and does not make the API depend on Next.

## Runtime signals

GET /health/live reports the process; GET /health/ready probes PostgreSQL and returns 503 during dependency failure. Structured JSON logs identify startup, failure, request completion and shutdown. Authenticated completion records include the verified OIDC subject for authorization auditing; treat it as a personal identifier and restrict log access and retention. Correlate request ID and W3C trace ID; neither grants authority. Unknown errors expose only a safe code publicly, while internal logs/spans retain safe category/SQLSTATE, not raw messages.

TELEMETRY_EXPORTER defaults to `none`, so stdout carries only JSON log lines; `console` prints raw spans for local debugging and is not JSON. Set `otlp` plus OTEL_EXPORTER_OTLP_ENDPOINT for an authorized HTTPS or local collector; `none` is an explicit opt-out. Exporters have bounded timeouts. Do not place credentials in endpoint URLs. Add collector-specific auth through its supported environment configuration and secret store. No public metrics endpoint is exposed.

SIGTERM/SIGINT stop HTTP acceptance, drain existing requests, close application/pool and flush telemetry. SHUTDOWN_TIMEOUT_MS defaults 8000 (100–30000 allowed); expiry forcibly closes connections and exits 1. Configure the platform grace period above this budget. Tests verify normal real-process shutdown, in-flight drain and forced bounded exit. Forced exit or ambiguous request timeout requires checking persisted state before retrying writes.

## Delivery and recovery

CI runs lint, architecture, types, build, unit/integration/runtime, schema drift/compatibility and dependency audit. Require that workflow in branch/release policy after repository creation; the scaffold cannot configure remote policies by existing locally.

For containers: `docker build --target runtime -t app-runtime .` and `docker build --target migrate -t app-migrate .`. Both use the same locked dependency build. The migrate image holds `prisma/`, the Prisma config, `scripts/migrate.mjs`, the Prisma CLI and its schema engine, and runs `prisma migrate deploy` as a non-root user; it exits 1 naming `DATABASE_URL` when that is missing. The runtime image holds the compiled API with the generated client and `@prisma/adapter-pg`, not the Prisma CLI. Run the migrate image once as a controlled release job before starting compatible runtime replicas. Do not run migrations independently in every replica. Docker execution still requires validation on the selected target.

Before release, assign an operator and record smoke checks (auth, ready, create/read), traffic/data-size targets, error/latency alerts, aggregate pool/limiter budgets, backup access/retention, secret rotation, RPO/RTO and a measured restore drill. In-memory limiting is single-process only; replicas need shared limits or a trusted gateway.

Roll back only to a binary compatible with the current schema. Use expand/backfill/switch/contract for destructive changes; a code rollback cannot undo data loss. Migration tests are not backup-restore evidence. Real provider/collector/cloud deployment, full load tests and actual restore/release drills remain unverified until explicitly run.
