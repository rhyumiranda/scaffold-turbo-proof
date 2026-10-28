# Reusable verification and configurable profiles

No provider, Redis server or cloud account is provisioned. Defaults remain JWT verification, PostgreSQL, single-process rate limiting, bounded requests and private owner-scoped example data. Actual provider and deployment evidence remain required.

## Identity and limits

AUTH_ISSUER, AUTH_AUDIENCE and AUTH_JWKS_URL select the provider boundary. RS256 JWT verification remains independent of frontend login. AUTH_JWKS_COOLDOWN_MS (default 30000) bounds refetch after an unknown key; AUTH_JWKS_CACHE_MS (default 600000) bounds cached public keys. The test:integration suite rotates real signing keys and proves rejection during an expired-cache provider outage. Cached keys can continue validating otherwise-valid tokens until expiry; this is not online revocation. Select short access-token lifetimes or an explicitly tested introspection/revocation adapter if the product needs immediate bearer revocation.

MAX_IN_FLIGHT defaults to 100 and rejects overload with a safe 503 and Retry-After before body parsing. Liveness bypasses capacity/rate checks; readiness probes the database and selected limiter dependency. The unit fixture holds an actual partial HTTP body, proves overload, then releases the connection and proves recovery. RATE_LIMIT defaults to 100 per RATE_WINDOW_MS=60000. These are conservative example values, not measured traffic promises.

For replicas, opt into LIMITER_MODE=redis, set LIMITER_REDIS_URL and the same LIMITER_NAMESPACE across replicas of this app/environment. TLS is required off loopback; use restricted Redis credentials/network policy. Limits use atomic Redis operations and fail closed with 503 during dependency failure. pnpm test:profiles needs TEST_REDIS_URL plus the isolated database; it exercises two real API instances, shared quota, forged forwarding headers, expiry and unavailable storage. No Redis fallback silently grants unlimited access.

TRUST_PROXY_CIDRS defaults empty. Set only explicit known proxy IPs/CIDRs from the actual hosting topology, never true or a guessed hop count. Proxy configuration is a security decision and needs target tests. Database pool capacity must be budgeted across all replicas; changing request limits alone does not increase DB capacity.

## Runtime and release evidence

pnpm test:telemetry proves the compiled API exports correlated HTTP/database spans and metrics to a loopback OTLP receiver and excludes a sensitive-query/header sentinel. The paired test/with-web.mjs harness additionally supports TEST_TELEMETRY=true for web/API/database export proof. Real collector auth, storage access, retention and alert delivery remain selected-project work.

pnpm test:container requires Docker. It builds the locked image, verifies missing-config failure, non-root HTTP liveness and bounded SIGTERM, then builds the separate `migrate` image and verifies it runs as non-root and fails fast naming `DATABASE_URL` when that is missing; it removes only its own containers/images. verification.config.json names environment inputs. Database readiness, migration-job permissions, actual TLS/proxy/hosting and artifact promotion still require target evidence. A missing daemon is a failed prerequisite, not a pass.

pnpm test:load uses explicit LOAD_URL and bounded GET workload: LOAD_REQUESTS, LOAD_CONCURRENCY, optional LOAD_BEARER, LOAD_P95_MS and LOAD_ERROR_RATE. It reports response-header latency percentiles, statuses and throughput without credential values. Choose a representative authenticated route and data size. It is not a server-memory profile or production saturation certification.

## Disposable restore exercise

With NODE_ENV=test, an explicitly disposable loopback DATABASE_URL and PG_BIN pointing to a compatible PostgreSQL tool directory, run pnpm test:recovery. RECOVERY_TABLES is a comma-separated allowlist of simple public table names to compare (default projects; adapt with your domain). The source is read-only. The script writes a logical backup as a permission-restricted migration artifact, starts a NEW temporary cluster, restores through the migration runner, verifies existing migration checksums, compares row counts/digests and stops the owned cluster. It never overwrites the source or drops a database. Temporary backup/cluster artifacts are retained for inspection; they contain test data and need deliberate retention/cleanup.

Run it without concurrent source writers so snapshot comparison is meaningful. This small-fixture drill uses bounded commands and is not intended for production-sized backups. It does not establish hosted backups, physical/PITR restore, encryption, real RPO/RTO or old/new binary compatibility. Those remain deployment-specific exercises. Never run this helper against shared or production data.

## Project inputs still required

Business permissions and workflows; transactions/idempotency for real operations; actual provider and token/revocation policy; data precision/retention; traffic/data distributions and pool budgets; hosting/proxies; backup access/retention and measured recovery targets; alert owners and release rollback compatibility. Optional jobs, tenancy, payments, uploads and AI are not automatically implemented by these runtime profiles.
