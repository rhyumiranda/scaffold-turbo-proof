# Reusable verification and configurable profiles

Defaults remain API-backed, private/no-store, one instance, and externally issued api_session. No provider, Redis server or cloud account is provisioned. Choose settings explicitly and keep actual provider/deployment gates blocked until verified.

## Select OIDC without selecting a vendor

Set AUTH_MODE=oidc, AUTH_APP_ORIGIN (exact HTTPS public origin), AUTH_ISSUER (issuer identifier, not discovery URL), AUTH_CLIENT_ID, AUTH_REDIS_URL and a unique AUTH_NAMESPACE for this application/environment. Set AUTH_CLIENT_SECRET only when the registered client requires it. The example supports the library's client-secret-post or public PKCE client; adapt and test other authentication methods explicitly. AUTH_SCOPE defaults to openid; add the provider's API access/offline scopes when required. AUTH_SESSION_SECONDS defaults to 3600, bounded 60–86400.

Register AUTH_APP_ORIGIN/auth/callback with the provider. It must issue an access token accepted by your API; this example does not exchange tokens for an arbitrary audience. Never use an ID token as an API access token. Redis stores provider tokens; require TLS off loopback, restricted ACLs/network access, persistence/retention appropriate to the session policy, and a distinct namespace. It stores no application domain data.

Application files: src/lib/identity.ts owns openid-client discovery, PKCE/state/nonce and server-side sessions; session.server.ts resolves per-request credentials; app/auth/[operation]/route.ts exposes login/callback and origin-checked POST refresh/logout. Cookies contain random opaque identifiers, not access or refresh tokens. HTTPS uses Secure, HttpOnly, SameSite=Lax and __Host- names. Callback transactions are single-use and expire after five minutes. Absolute session lifetime is not extended by refresh. Refresh is locked across instances and compare-and-set prevents logout resurrection. Invalid refresh ends the session; no automatic business-mutation retry occurs.

Logout deletes the shared session before best-effort provider token revocation. It is application logout, not guaranteed provider-wide/federated logout. Independently copied bearer access tokens may remain valid until their issuer expires/revokes them; immediate API revocation is a project policy. Provider outage, consent, refresh issuance, revocation and account switching must be checked against the chosen provider.

AUTH_INSECURE_LOOPBACK=true is only for an isolated local profile: both issuer and app must be loopback. It uses non-Secure local cookies; never configure this on a public deployment. The default remains false. No local test issuer is imported into application code.

Run TEST_REDIS_URL=<isolated Redis URL> pnpm test:identity for real protocol/Redis checks. For browser proof, configure the real API bootstrap, then pnpm test:identity:browser. The optional Nest adapter consumes NEST_TEST_PROJECT and a disposable DATABASE_URL. Its synthetic OIDC issuer is test infrastructure, not proof of your commercial provider.

## Release artifact and multiple instances

pnpm build prepares standalone static assets once; pnpm start only reads the prepared artifact. pnpm test:container builds an image, rejects missing configuration, checks non-root HTTP startup and SIGTERM, and removes only its own named containers/image. It requires a working Docker daemon; a missing daemon fails rather than skips. verification.config.json names required runtime environment variables without values. It does not prove API connectivity or deployment readiness.

For more than one instance, set DEPLOYMENT_REPLICAS, APP_DEPLOYMENT_ID and a valid base64 NEXT_SERVER_ACTIONS_ENCRYPTION_KEY at build time. Obtain the key through the project's secret manager, not a committed example. Build once and promote the same artifact. pnpm test:replicas uses two actual copies of the compiled runtime: render on A, submit actions on B, shared session storage and one public origin. No private cross-request data cache is enabled; adding shared/public caching requires its own invalidation tests. Rolling old/new releases, CDN behavior and load-balancer shutdown remain target checks.

## Observe and measure

OTEL_EXPORTER_OTLP_ENDPOINT enables exported traces and metrics. Framework span URL/header/event/resource fields are removed at the exporter; operation names/status and correlation remain. Do not add a second default exporter that bypasses this allowlist. pnpm test:telemetry uses the configured API test adapter; the paired adapter verifies actual exported web/API/database correlation and both apps' metrics at a loopback OTLP receiver, including a sensitive-query negative test. Another API needs an equivalent bootstrap. Vendor authentication, retention and alert delivery remain project choices.

pnpm test:load performs bounded GET requests against explicit LOAD_URL. Configure LOAD_REQUESTS (1–10000), LOAD_CONCURRENCY (1–128), optional LOAD_BEARER, LOAD_P95_MS and LOAD_ERROR_RATE. It reports response-header percentiles, status counts and throughput, never the token. Use only authorized targets. These measurements do not establish production capacity or full page rendering performance.

The browser suite includes axe checks, keyboard/layout tests and 200% text reflow; this does not certify native browser zoom, Safari, screen readers or WCAG conformance. Keep actual device, traffic and field Web Vitals evidence separate.

## Project inputs still required

Provider and API audience/scopes; session and revocation policy; UI/permissions/domain; real API test bootstrap; hosting/proxy/cache topology; traffic and latency goals; retention and monitoring owner; deployment and rollback policy. CI YAML alone does not establish a hosted passing run or repository protection.
