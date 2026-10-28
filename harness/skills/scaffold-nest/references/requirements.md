# Named requirements

Distilled from research captured 2026-10-26. B = baseline, P = selected profile, D = target evidence. These are scaffold requirements, not completed tests or official certification. Agent-ready A rules are baseline; AI-runtime L rules apply only to AI products.

For Nest, Q04 browser evidence requires a requested frontend; API-only HTTP/database evidence belongs in G03. Do not generate a frontend to satisfy a checklist.

The bundled reference implements a deliberately small subset. [Reference walkthrough](reference-walkthrough.md) identifies exact files, expected behavior, and integration gaps. Apply remaining relevant controls during the phases; never describe every row as already implemented.

| ID | Capability | Level or behavior | Evidence |
|---|---|---|---|
| F01 | Reproducible toolchain | B | Pin supported Node, package manager, framework pair, and lockfile; clean frozen install succeeds. |
| F02 | Strict TypeScript | B | Strict checking; consider `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; no blanket error suppression. |
| F03 | Feature-oriented modules | B | Features own operations and exports; automated checks reject prohibited cross-feature imports and cycles. |
| F04 | Runtime configuration validation | B | Missing/invalid required settings stop startup with safe messages; `.env.example` contains no secrets. |
| F05 | Explicit execution boundaries | B | Browser cannot import server credentials, backend code, or database clients. |
| F06 | Scaffold provenance | B | Record template version, selected options, dependency versions, and commands that produced the project. |
| N01 | Thin controllers and explicit use cases | B | Controllers translate HTTP; application services implement operations; tests exercise business rules without HTTP. |
| N02 | Runtime input validation | B | Validate body, path, query, and relevant headers; bound sizes; reject malformed and unexpected writable fields. |
| N03 | Response DTO minimization | B | Explicit response mapping; password hashes, internal flags, and tokens never appear in API output. |
| N04 | OpenAPI contract pipeline | B | Export schema, detect breaking changes and regeneration drift in CI. Client generation belongs to the consumer. |
| N05 | Consistent problem responses | B | Stable error codes, HTTP status, field errors, and request ID; no stack traces or raw provider errors. |
| N06 | Bounded collection queries | B | Maximum page size, allowed filters/sorts, deterministic ordering, and tested empty results. |
| N07 | Controlled dependency lifetime | B | No caller-specific state on singleton services; explicit request context; no unnecessary request-scoped dependency graph. |
| N08 | External integration adapters | P | Timeouts, typed failures, safe credential handling, and provider-specific test doubles. |
| S01 | Explicit authentication profile | B | Public-only or selected auth provider; never silently ship mock login as production authentication. |
| S02 | Resource authorization | B | Deny by default; check operation and object ownership; tests call the API directly to bypass the UI. |
| S03 | Tenant isolation | P | Derive/validate tenant context against membership; scope data, cache keys, jobs, and audit records; test two tenants. |
| S04 | Session lifecycle | P | Secure HttpOnly cookies where applicable, expiry, rotation/revocation, logout, and rejected stale sessions. |
| S05 | Browser request defenses | B | HTTPS policy, narrow CORS, cookie-appropriate CSRF defenses, CSP/security headers, trusted proxy configuration. |
| S06 | Abuse and resource limits | B/D | Bound request size, execution time, concurrency, and expensive operations; shared limiter for replicated deployments. |
| S07 | Secret and personal-data handling | B/D | Server-only secrets, log redaction, secret scanning, rotation process, retention policy, restricted telemetry access. |
| S08 | Security verification plan | B/D | Map relevant ASVS requirements to tests/evidence; schedule dependency and framework security updates. |
| D01 | Database-enforced invariants | B | Foreign keys, uniqueness, nullability, checks, and indexes reflect the actual business constraints. |
| D02 | Transaction boundaries | B | Related writes commit together; rollback behavior tested; external network calls do not hold avoidable database locks. |
| D03 | Concurrency control | B/P | Choose atomic conditional writes, version checks, or isolation/locking per operation; parallel requests preserve invariants. |
| D04 | Reviewed migration artifacts | B | Versioned migrations, one application process in release flow, migration status checks, clean and upgrade tests. |
| D05 | Expand-and-contract changes | P/D | Add compatible schema, deploy/backfill, switch use, remove old schema later; old and new binaries coexist safely. |
| D06 | Connection and query budgets | B/D | Pool limits across all replicas; query timeouts; representative-data plans; detect excessive queries. |
| D07 | Backup and restore | D | Encrypted backups, retention and access controls, recovery objectives, and a timed restore drill. |
| D08 | Data representation contracts | B | Explicit time zones, timestamp serialization, money/currency precision, large IDs, nullability, and deletion semantics. |
| R01 | End-to-end deadlines | B | Bound HTTP/database/provider work; propagate cancellation where supported; return a usable timeout state. |
| R02 | Selective retries | B | Retry only transient, safe operations with bounded backoff/jitter; avoid multiplying retries across layers. |
| R03 | Durable idempotency | P | Store operation identity and result with correct atomicity; same key/input repeats safely; changed payload is rejected. |
| R04 | Durable background work | P | Separate worker process when required; bounded concurrency, retries, failed-job inspection, replay, and shutdown behavior. |
| R05 | Transactional outbox and deduplication | P | Persist business change plus event atomically; consumers tolerate repeated delivery and handle failed processing. |
| R06 | Webhook authenticity and replay safety | P | Verify signature against raw bytes, enforce replay policy, persist before acknowledgement, deduplicate repeated events. |
| R07 | Health and graceful shutdown | B/D | Distinguish liveness/readiness/startup; stop accepting work, drain bounded work, close pools on termination. |
| R08 | Overload and degraded operation | P/D | Queue/concurrency limits; explicit unavailable states; provider outage does not exhaust the entire application. |
| Q01 | Domain invariant tests | B | State transitions, permission decisions, precision rules, and other meaningful logic. |
| Q02 | Real dependency integration tests | B | Real disposable database; real queue when selected; validation, transactions, and query behavior. |
| Q03 | Contract compatibility tests | B | Validate response shape, error cases, schema/client regeneration, and incompatible changes. |
| Q04 | Browser journey tests | B | Real web → API → database path, authentication profile, reload, failure/recovery, and keyboard use. |
| Q05 | Adversarial and concurrency tests | B/P | Cross-user access, cross-tenant access, forged requests, double clicks, retries, race conditions. |
| Q06 | Deployment and recovery exercises | D | Container boot, missing config, dependency loss, SIGTERM, migration upgrade, rollback compatibility, and restore. |
| Q07 | Performance evidence | D | Stated traffic/data shape, cold/warm paths, latency percentiles, throughput, memory, and saturation behavior. |
| O01 | Structured, redacted logs | B | Consistent fields, request/trace IDs, safe error detail, no credentials or raw sensitive payloads. |
| O02 | Cross-service traces and metrics | B/D | Correlate Next/API/database/worker work; measure rate, errors, latency, pool saturation, and queue age. |
| O03 | SLOs and actionable alerts | D | User-centered target, measurement window, thresholds, owner, and response instructions. |
| O04 | Security audit trail | P | Actor, action, resource, outcome, and time; separate access/retention policy from ordinary debug logs. |
| O05 | Reproducible release artifacts | B/D | Multi-stage, non-root images; locked dependencies; promote tested artifacts; account for public build-time settings. |
| O06 | Secure CI/CD | B/D | Format/lint/types/tests/build/security checks; minimal permissions; pinned actions; safe untrusted-PR handling. |
| O07 | Short-lived deployment credentials | P/D | OIDC trust scoped to the intended repository/environment; no unnecessary long-lived cloud keys. |
| O08 | Release and recovery runbooks | D | Controlled migrations, smoke checks, rollback strategy, escalation owner, backup restore, secret rotation. |
| A01 | Repository navigation map | B | Short `AGENTS.md` pointing to architecture, commands, feature flows, and constraints. |
| A02 | Architectural decision records | B | Record consequential choices, reasons, alternatives, and revisit conditions. |
| A03 | Executable architecture rules | B | Import constraints and contract checks fail with useful correction messages. |
| A04 | Reproducible agent environment | B | Deterministic setup, disposable fixtures, isolated test databases, predictable ports, no production secrets needed. |
| A05 | Inspectable tools | B | Stable commands, useful exit codes, bounded logs, structured reports, dry-run support for generators. |
| A06 | Ground-truth feedback | B | Compiler, tests, actual browser, traces, and persisted state establish success. |
| A07 | Controlled permissions | B | Scoped workspace/network/credentials; retrieved text cannot expand tool authority. |
| A08 | Maintained context and handoff | B | Feature index, runnable examples, current decisions, stale-link checks, and reproducible failure reports. |
| L01 | Model/provider adapter | P | Configurable supported models, recorded version/settings, typed provider failures; no SDK calls scattered through controllers. |
| L02 | Structured output validation | P | Schema-validate model/tool outputs; treat plausible text as untrusted until checks pass. |
| L03 | Versioned prompts and evaluation cases | P | Reviewable templates and representative success/failure datasets; no real secrets or personal data in fixtures. |
| L04 | Outcome-based evaluations | P | Score actual task results, tool choices, permissions, groundedness, latency, and cost; repeat stochastic trials. |
| L05 | Authorized tool execution | P | Deterministic allowlist, caller-scoped permissions, validated arguments, audit evidence, approvals for product-defined high-impact actions. |
| L06 | Prompt-injection containment | P | External text remains data; restrict network/filesystem/tool access; test malicious documents and tool output. |
| L07 | Bounded execution | P | Token/cost/time/step limits, cancellation, concurrency limits, retry budgets, and understandable failure states. |
| L08 | Retrieval permissions and provenance | P | Enforce document/tenant ACLs before model access; sources, index freshness, deletion, and citation checks. |
| L09 | Privacy and trace policy | P | Decide what prompts/outputs may be stored, where, for how long, and who may read them. |
| L10 | Controlled rollout and recovery | P | Version comparisons, monitored rollout, kill switch, rollback, and explicit behavior when AI is unavailable. |
