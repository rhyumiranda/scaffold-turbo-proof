# Security, reliability, and delivery

Read for phases 4 and 7–9. Apply S, R, and O requirements to the chosen product/deployment.

## Identity and access

Use the chosen identity integration, not a production mock or a new homegrown identity system by default. Validate token/session authenticity, expiry, and relevant issuer/audience/algorithm constraints using the provider's supported library. Do not trust a caller-supplied user or tenant header. A frontend session check does not authorize the API.

Define permissions per operation and resource. Scope queries to the permitted user/organization where appropriate; test direct HTTP calls that bypass the UI. Roles alone do not establish access to a particular record. Public-only is a deliberate profile, not a workaround for unresolved authentication. Test data exposure and writes even without login.

For tenancy, validate membership and scope records, caches, jobs, exports, and audit records. Use independent test identities/tenants. Where sessions are owned here, define expiry, revocation, rotation, logout, cookie security, and stale-session behavior. Avoid personal data and credentials in logs/test fixtures.

Configure narrow origins, credential handling, cookie-appropriate CSRF defenses, headers, HTTPS termination, and trusted proxies for actual hosting. CORS is not authorization. Limit body size, expensive operations, duration, and concurrency. In-memory rate limits are not shared across replicas.

## Partial failures

Set end-to-end deadlines; bound individual database/provider calls within the budget. Propagate cancellation where supported. Retry only safe transient operations, with bounded backoff/jitter. Do not automatically replay a write after an ambiguous response unless its idempotency semantics support that.

Use isolated adapters for external providers. Typed failures should preserve useful internal diagnostic context while mapping to safe public errors. Avoid unbounded parallel work and retry multiplication across web/API/SDK layers. Define degraded/unavailable states and queue limits before adding retry logic.

Durable idempotency requires atomic operation identity, payload equivalence, result retention, in-progress handling, and conflict rules. A disabled button or in-memory set does not provide durable idempotency. Use [optional profiles](optional-profiles.md) for jobs/outbox/webhooks.

## Runtime behavior

Provide liveness (process), readiness (can serve), and startup checks as appropriate. Do not make a dependency outage create endless liveness-triggered restarts. Never return constant success as proof of database readiness. Restrict health detail exposed publicly.

Enable Nest shutdown listeners deliberately; handle stop-accepting/drain/close with bounded deadlines. Active timers and workers can keep the process alive after app.close. Test the actual process signal supported by the target. [Lifecycle documentation](https://docs.nestjs.com/fundamentals/lifecycle-events)

Use structured, redacted logs and request/trace IDs across operations and providers. Add supported traces/metrics; do not assume every telemetry signal or browser SDK is equally mature. Measure rate, errors, duration, database saturation, and queue age where applicable. Separate security audit records from debug logs with their own access/retention rules.

## Delivery evidence

CI should gate lint, types, tests, contract drift, dependency/security checks, and production build before artifact promotion. Do not rely on Docker build alone. Pin third-party actions, minimize permissions, isolate untrusted PR code from credentials, and use narrowly scoped short-lived credentials where supported. Do not provision identities or rotate real secrets without authority.

Build reproducibly with locked dependencies; use multistage/non-root containers if containers fit the selected target. Document config injection, migration ownership, readiness, graceful stop, smoke tests, rollout and rollback.

Define user-visible reliability targets, alert owners, escalation, and recovery objectives appropriate to the product. Templates/runbooks are not evidence of configured alerts, successful restores, capacity, or compliance. Select applicable ASVS controls and map evidence; do not claim certification from a scaffold.
