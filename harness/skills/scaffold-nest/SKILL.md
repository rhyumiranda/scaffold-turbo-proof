---
name: scaffold-nest
description: Scaffold and verify a new NestJS API through architecture, data, security, contract, feature, reliability, and delivery phases. Use for a reusable backend foundation, not ordinary feature edits or production deployment unless requested.
metadata:
  short-description: Phase-driven NestJS project scaffolding
---

# Scaffold NestJS

Build the requested API, not a plan for building it. Implement and check each phase below. Start from the bundled executable reference, then adapt and verify it. It is domain-independent, not a universal production certification. No frontend or companion skill is required.

## Operating contract

- First read the [executable reference walkthrough](references/reference-walkthrough.md). Each phase maps to exact source files, commands, expected responses, and tests. Copy with `node <skill-directory>/scripts/scaffold.mjs --destination /absolute/new-project --name app-name`; use `--dry-run` for a no-write preview. Do not re-invent the baseline from prose.
- Keep the reference's security/concurrency/input-preservation tests when adapting it. Read [reference validation](references/reference-validation.md) for tested versions and unverified boundaries.
- Read [runtime profiles](references/production-profiles.md) when selecting identity, replicated hosting, telemetry, load or recovery checks. Use the shipped code and commands; keep real provider and target choices configurable.
- For each phase, inspect its mapped source, adapt it, then run the mapped check before marking it complete. Use [baseline coverage](references/baseline-map.md) to distinguish shipped controls from provider/target work. An unsupported profile requires implementation and evidence, not a claim that the base template covers it.

- Read [project intake](references/intake.md) first. Separate scaffolding a project from adding a feature. Follow applicable preflight instructions before existing-project changes.
- Preserve user choices. The executable reference uses feature modules, REST/OpenAPI, PostgreSQL, and npm. Other choices are adaptations requiring equivalent evidence, not untested drop-in profiles.
- Read [architecture and data](references/architecture-data.md) before phases 2–6; [security and reliability](references/security-reliability.md) before phases 4 and 7–9; [verification](references/verification.md) before checks.
- Track applicability and evidence with [requirements](references/requirements.md). Check version-sensitive behavior against [primary sources](references/sources.md). No unpinned latest generator or invented tested version matrix.
- The bundled assets/reference is application code. The feature-contract asset is a project record; the generator creates a fresh manifest. Start gates unrun; update only from observed results.
- Implement tests alongside each phase. Continue independent work when blocked, without claiming dependent work passed. Missing infrastructure is blocked, not “not applicable.”
- Scaffolding does not authorize publishing, deployment, billing, production writes, or commits. Use isolated test resources; preserve existing files, secrets, and edits.
- Direct agent database inspection is read-only. Administrative schema/data changes go through migrations. With Prisma, apply reviewed migrations using `prisma migrate deploy`; never `migrate dev`, `migrate reset`, or `db push`.
- Do not generate unrestricted CRUD or deletion for every model. “Projects” is a removable example, not a mandatory domain.

## Phase 1 — Establish the project contract

Resolve destination, purpose, actors, allowed operations, data sensitivity, ownership, authentication, database, deployment intent, and optional capabilities. Recover settled decisions before asking. Preview paths, versions, commands, and side effects; dry run means no writes. Resolve paths and symlinks before generation.
Output: completed feature contract and draft scaffold manifest.
Gate: no silent guess about identity, record access, deletion, or destination conflicts.

## Phase 2 — Generate the engineering foundation

Generate the bundled locked reference first. Its version matrix and file map are in the walkthrough. Change framework/tool versions only after checking official compatibility/security guidance and rerunning the full affected tests. A requested alternative profile is an explicit adaptation, not a fresh unverified interpretation. Build feature modules, strict TypeScript, non-mutating lint/type/test commands, import checks, validated config, and safe environment examples.
Output: runnable base API, lockfile, architecture map, and short AGENTS.md.
Gate: frozen install, lint, types, production build, and invalid-config failure pass. F01–F06, A01–A05.

## Phase 3 — Establish database correctness

Implement constraints, indexes, explicit data representations, connection budgets, reviewed migrations, transactions, and operation-specific concurrency controls. Establish a disposable test database; never infer a shared connection is safe for tests. Check migration authoring/application commands against the selected tool version.
Output: schema, migrations, database lifecycle, integration fixtures.
Gate: clean migration, upgrade where applicable, constraints, rollback, and competing-write tests pass. D01–D06, D08.

## Phase 4 — Establish identity and authorization

Integrate the chosen provider or explicitly selected public-only profile. Verify credentials, deny protected operations by default, authorize each resource/operation, and reject caller-supplied identity overrides. Add tenant membership only when selected. Configure session lifecycle, request limits, trusted proxies, and appropriate browser defenses.
Output: authentication boundary and explicit access policy.
Gate: direct HTTP tests reject missing/expired/forged credentials and cross-user access. Public-only still tests data exposure and input. S01–S06.

## Phase 5 — Establish the HTTP contract

Keep controllers thin; implement runtime validation, deliberate coercion, response DTOs, stable safe errors, and bounded collections. Generate OpenAPI, validate response/schema agreement, and check schema drift and accepted-contract compatibility. The checked-in `openapi.json` is the only exported contract, never ORM models or Nest providers. This skill ships no generated client; the consuming frontend or `scaffold-turbo-nest-next` generates browser-safe types from `openapi.json`.
Output: executable API contract and contract tests.
Gate: malformed/unknown fields fail as specified; sensitive outputs are excluded; checked-in schema equals fresh compiled metadata and accepted operations are unchanged. N01–N07, Q03.

## Phase 6 — Implement one complete domain slice

Choose a small actual product resource and its agreed operations. If no domain is specified, label a user-owned projects create/list/read/rename flow as a removable example. Do not invent ownership for shared data or deletion without a policy. Keep authoritative behavior in application operations.
Output: persisted resource flow, authorization, validation, and tests.
Gate: compiled API plus real database completes the flow, preserves state, rejects invalid changes, and enforces access. Q01–Q02, Q05.

## Phase 7 — Make failure behavior explicit

Implement bounded HTTP/database/provider work, cancellation where supported, safe failures, and selective retries. Avoid retry multiplication and replay of unsafe mutations. Isolate integrations behind small adapters. Read [optional profiles](references/optional-profiles.md) only for selected tenancy/jobs/webhook/AI requirements and implement their failure tests.
Output: deadlines, overload behavior, adapters, selected durable-work controls.
Gate: timeouts, repeated requests, competing writes, and selected redelivery scenarios preserve invariants. N08, R01–R06, R08.

## Phase 8 — Add runtime visibility and lifecycle controls

Add redacted structured logs, correlation, supported tracing/metrics, and separate liveness/readiness/startup behavior. Enable and test bounded shutdown, draining work and closing pools. Add security audit events where needed.
Output: inspectable runtime and lifecycle controls.
Gate: dependency loss, termination signals, and log-redaction tests pass; readiness is not a constant success. R07, O01–O04, S07.

## Phase 9 — Add delivery and recovery foundations

Create CI gates and target-appropriate packaging. Require checks before artifact promotion; use least-privilege credentials and controlled migration application. Document smoke checks, rollback compatibility, recovery objectives, restore, rotation, and ownership. Without a target, ship local packaging and mark target controls pending; do not provision a provider.
Output: CI, selected delivery config, operational instructions.
Gate: local release artifact boots and passes smoke tests. Restore, load, alerts, and deployment need real-target evidence. O05–O08, D05, D07, S08.

## Phase 10 — Verify and hand off

Run [verification gates](references/verification.md) against generated files and the compiled app, not a remembered template. Capture commands, environment, results, artifacts, versions, and blocked/skipped reasons. Verify reruns preserve edits. Update the manifest and run:
`node <skill-directory>/scripts/check-manifest.mjs <project>/scaffold-manifest.json`
First run the executable gate commands in the verification guide. This checker validates report consistency only; it cannot prove tests passed or replace those commands.
Output: working API, contract, setup/feature/operations notes, and evidence report.
Gate: applicable local checks pass before “locally verified”; G09 passes before “deployment verified.” State blockers without claiming production certification.

## Completion response

Give the absolute project path, run commands, completed feature, actual checks/results, and unresolved integration/deployment work. Installing this skill is not generating an application.
