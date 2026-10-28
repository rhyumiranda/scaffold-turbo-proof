# Named requirements

Distilled from research captured 2026-10-26. B = baseline, P = selected profile, D = target evidence. These are scaffold requirements, not completed tests or official certification. Agent-ready A rules are baseline; AI-runtime L rules apply only to AI products.

For Next, database/queue/recovery ownership remains with the supplied API. Test the integration or record upstream evidence; do not create a database or worker to satisfy inherited requirements. N04 means consuming/checking a contract, not generating a Nest backend.

The bundled reference implements a deliberately small subset. [Reference walkthrough](reference-walkthrough.md) identifies exact files, expected behavior, and integration gaps. Apply remaining relevant controls during the phases; never describe every row as already implemented.

| ID | Capability | Level or behavior | Evidence |
|---|---|---|---|
| F01 | Reproducible toolchain | B | Pin supported Node, package manager, framework pair, and lockfile; clean frozen install succeeds. |
| F02 | Strict TypeScript | B | Strict checking; consider `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; no blanket error suppression. |
| F03 | Feature-oriented modules | B | Features own operations and exports; automated checks reject prohibited cross-feature imports and cycles. |
| F04 | Runtime configuration validation | B | Missing/invalid required settings stop startup with safe messages; `.env.example` contains no secrets. |
| F05 | Explicit execution boundaries | B | Browser cannot import server credentials, backend code, or database clients. |
| F06 | Scaffold provenance | B | Record template version, selected options, dependency versions, and commands that produced the project. |
| N04 | OpenAPI contract pipeline | B | Export schema, generate client, detect breaking changes and regeneration drift in CI. |
| N05 | Consistent problem responses | B | Stable error codes, HTTP status, field errors, and request ID; no stack traces or raw provider errors. |
| S01 | Explicit authentication profile | B | Public-only or selected auth provider; never silently ship mock login as production authentication. |
| S02 | Resource authorization | B | Deny by default; check operation and object ownership; tests call the API directly to bypass the UI. |
| S03 | Tenant isolation | P | Derive/validate tenant context against membership; scope data, cache keys, jobs, and audit records; test two tenants. |
| S04 | Session lifecycle | P | Secure HttpOnly cookies where applicable, expiry, rotation/revocation, logout, and rejected stale sessions. |
| S05 | Browser request defenses | B | HTTPS policy, narrow CORS, cookie-appropriate CSRF defenses, CSP/security headers, trusted proxy configuration. |
| S06 | Abuse and resource limits | B/D | Bound request size, execution time, concurrency, and expensive operations; shared limiter for replicated deployments. |
| S07 | Secret and personal-data handling | B/D | Server-only secrets, log redaction, secret scanning, rotation process, retention policy, restricted telemetry access. |
| S08 | Security verification plan | B/D | Map relevant ASVS requirements to tests/evidence; schedule dependency and framework security updates. |
| R01 | End-to-end deadlines | B | Bound HTTP/database/provider work; propagate cancellation where supported; return a usable timeout state. |
| R02 | Selective retries | B | Retry only transient, safe operations with bounded backoff/jitter; avoid multiplying retries across layers. |
| W01 | Server-first rendering | B | Server Components for initial reads; small Client Components for interaction; no secret-bearing props. |
| W02 | Four-layer feature structure | B | Components/hooks/actions/services with documented read/write routes and enforced server/browser imports. |
| W03 | Explicit cache policy | B | Classify data as public, private, or request-local; define freshness, invalidation, audience, and cache keys. |
| W04 | Mutation consistency | B | Validate on server, map field failures, coordinate client/server cache refresh, test repeated submission and stale UI. |
| W05 | Complete route states | B | Loading, empty, error, not found, forbidden, session expiry, and recovery paths are implemented. |
| W06 | URL and navigation state | B | Filters/pagination/tab state follow product needs; refresh and Back/Forward preserve intended state. |
| W07 | Accessible responsive UI | B | Semantic controls, keyboard/focus handling, clear errors, reduced motion, zoom, and requested screen sizes. |
| W08 | Performance and metadata | B/D | Budget client JS, optimize media/fonts, measure field performance, provide context-specific titles and public-page metadata. |
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
