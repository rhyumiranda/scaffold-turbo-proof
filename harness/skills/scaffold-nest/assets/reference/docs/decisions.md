# Decisions

## Contract states existing validation

The schema now declares what the server already enforced: request bodies have `additionalProperties: false` (the ValidationPipe rejects unknown fields), path `id` values are `format: uuid` (ParseUUIDPipe), and empty or non-integer `limit`/`offset` values are rejected with 400 instead of silently becoming 0. The compatibility check correctly reported these as breaking against the old baseline; the baseline was replaced once because the reference has no released consumers.

## RFC 9457 error responses

Errors follow RFC 9457 with `type: about:blank`, so `title` is the HTTP status phrase, such as `Conflict`. Each response has a safe `detail`, an `instance` path without the query string, the stable `code`, the `requestId`, and for 400s structured `errors` of `{field, code, message}`. The shared `ProblemDetails` schema is one OpenAPI component. Messages name the field and rule, never the submitted value. The accepted baseline was replaced for this change, as the reference has no released consumers.

## TypeScript stays on 5.9.3

TypeScript 7.0 is out, but typescript-eslint 8.72 declares `typescript >=4.8.4 <6.1.0`, so linting would be unsupported on 7. Revisit when typescript-eslint supports TypeScript 7, then rerun every gate.

## Reference 1.3.2 — URI versioning

Resource routes are versioned in the URI: `/v1/projects`. Only resource controllers opt in with `@Controller({ path, version })`; `/health/live` and `/health/ready` stay unversioned because probes and the container healthcheck call them. The accepted baseline was replaced once for this change because the reference has no released consumers. After release, add `/v2` controllers beside `/v1` instead of editing accepted operations.

## Reference 1.2.1 — Input boundary corrections

The independent audit additionally exercised oversized expectedVersion values and malformed request encodings. Expected versions now fit PostgreSQL's signed integer range; the trusted body-parser boundary translates its 400/413/415 errors before the global problem filter. Arbitrary application exceptions still become redacted 500s. Valid compressed JSON remains supported. The initial accepted schema includes the range and 415 response; consumers regenerate their own clients from it. This is a reviewed unpublished-example correction, not a waiver of compatibility for deployed consumers.

Reject NUL at the DTO boundary before application/database work: PostgreSQL text cannot store it. The initial accepted OpenAPI now includes this restriction; real create/rename tests prove 400 with field feedback and unchanged persisted state. Unicode remains supported. This is a deliberate correction to the unpublished reference, not authorization to silently tighten a released API contract. New consumers must review compatibility.

## Modular application, PostgreSQL and REST

One API process keeps operations easy to test and deploy. Feature modules make ownership explicit; no microservices/CQRS/repository interface is added for trivial CRUD. Revisit when an independently scaled boundary or substitutable integration exists. Prisma ORM 7 is the data layer because the owner's team uses it. Ownership and concurrency predicates stay visible in each module's repository (`where: { id, ownerId, version }`), `CHECK` constraints live in the migration SQL, and the same constraint, conflict and outage tests prove them. The client uses the `pg` driver adapter over a platform-owned pool, so pool size, timeouts and the pool metrics are unchanged from the earlier plain-SQL design. Each module owns a folder of the multi-file schema; there are no foreign keys (`relationMode = "prisma"`, plain IDs across modules), so a module can later move to its own database without untangling constraints. Migrations are committed SQL applied only with `prisma migrate deploy`; because that command does not refuse an edited, already-applied migration (verified: it exits 0 and says nothing), `scripts/migrate.mjs` compares the recorded checksums first. It also does not run a migration in a transaction (verified: a failing statement left the earlier `CREATE TABLE` behind), so every migration file is wrapped in `BEGIN;` … `COMMIT;` and `check:arch` enforces that.

## OIDC/JWKS verification, not a homegrown login system

Runtime accepts RS256 access tokens for configured issuer/audience. Test-only RSA keys are generated in tests. Real provider choice, token scope policy and web login/session lifecycle must be integrated per product. Never ship a test issuer or plaintext identity header as authentication.

## Conservative contracts

Before publishing the initial reference, repaired pagination integer schemas and explicit parser-error responses (400 malformed JSON, 413 oversized body). This accepted baseline represents the corrected initial contract, not a waiver for later breaking changes.

`contracts/accepted.openapi.json` is the initial reviewed baseline. A new generated product may deliberately replace the example contract before any consumers exist: record that decision, have consumers regenerate their clients, validate responses, then explicitly accept the new baseline. Once consumers exist, preserve accepted operations or introduce a versioned migration. CI must not silently regenerate the accepted baseline.

## Portable observability

Manual OpenTelemetry API 1.10.0, Node SDK 0.300.0 and trace/metric SDKs 3.0.0 record HTTP and database spans, request counts/duration and pool occupancy. Console export works locally; OTLP requires an explicitly configured collector. No log SDK or browser auto-instrumentation is implied. Only bounded route templates/status/method and safe error categories enter telemetry, never SQL or personal data. Target sampling, retention/access, SLOs and alerts remain deployment decisions.

API usage checked against [OpenTelemetry JavaScript instrumentation](https://opentelemetry.io/docs/languages/js/instrumentation/), its installed versioned declarations and [Node 24 HTTP lifecycle](https://nodejs.org/docs/latest-v24.x/api/http.html). Nest lifecycle hooks alone do not prove process draining; main explicitly stops HTTP acceptance, waits for requests, closes Nest/pool and flushes telemetry under an eight-second default deadline.
