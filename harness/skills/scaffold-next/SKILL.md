---
name: scaffold-next
description: Scaffold and verify a new API-backed Next.js frontend using components, hooks, actions, and services, server-first rendering, explicit caching, accessible flows, and production-build browser checks. Use for a project foundation, not ordinary UI edits or an automatic backend rewrite.
metadata:
  short-description: Phase-driven four-layer Next.js scaffolding
---

# Scaffold Next.js

Build the requested frontend, not a plan for building it. Implement and check each phase below. Start from the bundled executable reference, then adapt and verify it. It is domain-independent, not a universal production certification. It accepts an existing API; NestJS and a companion skill are not required.

## Operating contract

- First read the [executable reference walkthrough](references/reference-walkthrough.md). Each phase maps to exact source files, commands, expected responses, and tests. Copy with `node <skill-directory>/scripts/scaffold.mjs --destination /absolute/new-project --name app-name`; use `--dry-run` for a no-write preview. Do not re-invent the baseline from prose.
- Keep the reference's security/concurrency/input-preservation tests when adapting it. Read [reference validation](references/reference-validation.md) for tested versions and unverified boundaries.
- Read [runtime profiles](references/production-profiles.md) when selecting identity, replicated hosting, telemetry, load or recovery checks. Use the shipped code and commands; keep real provider and target choices configurable.
- For each phase, inspect its mapped source, adapt it, then run the mapped check before marking it complete. Use [baseline coverage](references/baseline-map.md) to distinguish shipped controls from provider/target work. An unsupported profile requires implementation and evidence, not a claim that the base template covers it.

- Read [project intake](references/intake.md) first. Follow applicable preflight for existing-project changes; do not restructure an app without authorization.
- Preserve the user's four responsibilities: components, hooks, actions, services. Server Components may skip the hook because they hold no client state. Client components never skip it: every client read and every client mutation goes through a hook, and only the hook imports a Server Action.
- Read [architecture and transport](references/architecture.md) before phases 2–4; [security and caching](references/security-caching.md) before phases 4–6; [UI and operations](references/ui-operations.md) before phases 7–9; [verification](references/verification.md) before checks.
- Use [requirements](references/requirements.md) for applicability/evidence and [primary sources](references/sources.md) for version-sensitive behavior. No unpinned latest generator or invented tested version matrix.
- The bundled assets/reference is application code. The feature-contract asset is a project record; the generator creates a fresh manifest. Start gates unrun; update only from observed checks.
- Test alongside implementation. Continue independent work when blocked; missing API credentials or test infrastructure is not “not applicable.”
- No backend generation, database access, publishing, deployment, billing, or commits are implied. Protect existing edits and environment files. Keep credentials out of browser artifacts and props.
- This profile is API-backed: the API owns data/business decisions and independently authorizes operations. Do not add an ORM or duplicate its business rules in Next.
- “Projects” is a removable example only. Use actual resources/operations when known; do not invent CRUD, ownership, deletion, or branding.
- If the request is a static site or deliberately Next-only database application, flag the profile mismatch and agree scope rather than silently introducing an API.

## Phase 1 — Establish the frontend contract

Resolve destination, routes/journeys, actors, access, API schema/error/auth contract, design system, data sensitivity, runtime target, and optional capabilities. Recover settled decisions before asking. Preview paths, writes, commands, and side effects; dry run means no writes. Check symlinks and conflicts.
Output: completed feature contract, route map, draft scaffold manifest.
Gate: API behavior is known or explicitly unresolved; fixtures never count as real integration.

## Phase 2 — Generate the engineering foundation

Generate the bundled locked reference first. Use its version matrix and file map. Change framework/tool versions only after official compatibility/security checks and rerunning affected tests. A different API/auth profile is an explicit adaptation, not a fresh unverified interpretation. Configure strict types, non-mutating lint, tests/build, validated environments, and browser/server import checks.
Output: base app, lockfile, architecture map, short AGENTS.md, feature responsibility structure.
Gate: frozen install, lint, types, production build, and prohibited-import checks pass. F01–F06, A01–A05.

## Phase 3 — Establish rendering and layer responsibilities

Use Server Components for suitable initial reads and focused Client Components for interaction. Components render; hooks coordinate client/query state; actions expose validated server mutations; services provide typed transport, deadlines, and safe failures.
Use only the four data paths in [architecture](references/architecture.md#read-and-mutation-paths). Every client read and client mutation goes through a hook; `check:arch` enforces it.
Do not send server reads through the app's own HTTP adapter or use Server Actions as the ordinary GET transport.
Output: enforceable boundaries and deliberate rendering strategy.
Gate: no unnecessary initial browser fetch, secret-bearing props, server import leaks, or mutation during rendering. W01–W02.

## Phase 4 — Establish API and session boundaries

Generate a browser-safe client from the real API contract; add runtime response checks at risky external boundaries. Separate browser/server service entrypoints. Integrate sessions, validate inputs, and check protected server entrypoints on every call. Preserve upstream resource authorization. Add appropriate origin/CSRF/header controls, deadlines, cancellation, and safe errors.
Output: typed integration and session-aware adapters.
Gate: expired/forged requests fail; direct action/handler calls cannot bypass checks; credentials remain server-only. S01–S07, N04–N05, R01–R02.

## Phase 5 — Define caching and navigation behavior

For each resource record audience, public/private/request-local classification, freshness, keys, invalidation, and post-mutation refresh. Use APIs matching the selected version and cache mode. Use one client query strategy per resource. Put shareable filters/tabs/pagination in the URL; preserve intended refresh and Back/Forward state.
Output: explicit cache/navigation policy and executable examples.
Gate: two users cannot share private cached results; mutations refresh affected views; logout/navigation do not expose stale privileged data. W03–W04, W06.

## Phase 6 — Implement one complete user journey

Implement the agreed resource list/detail and permitted create/change operations. Include server initial reads, interactive mutations, validation, pending feedback, repeated-action handling, cache refresh, and persisted results. Match backend policy; do not infer deletion or ownership from fields. Use the removable projects example only with a compatible explicit contract.
Output: connected UI, not disconnected mock screens.
Gate: a browser completes the journey against a real API and confirms persistence after reload. Fixture-only UI checks leave real integration blocked. Q03–Q05.

## Phase 7 — Complete accessibility and recovery

Implement loading, empty, sparse/dense, not-found, forbidden, expired-session, outage, and recovery states. Follow project design rules. Ensure semantic controls, keyboard operation, visible focus, labels, useful errors, reduced motion, zoom, responsive/long-content layouts, and applicable unsaved-change warnings.
Output: usable states with UI/failure tests.
Gate: journey works by keyboard and at mobile/laptop/ultrawide sizes; failures offer recovery without losing useful input. W05–W07.

## Phase 8 — Establish performance and metadata

Budget client JavaScript, isolate expensive interactions, optimize images/fonts, avoid layout shift, and bound large-list rendering. Add accurate titles and public metadata without exposing private content. Profile production code under representative CPU/network conditions; record assumptions.
Output: budgets, metadata, measurement evidence.
Gate: explain measured regressions and fixes; lab checks are not real-user field results. W08, Q07.

## Phase 9 — Add delivery and runtime foundations

Generate CI for lint, types, contract drift, tests, security checks, and production builds. Add target-appropriate packaging, safe logs/correlation, build-time environment documentation, smoke tests, and recovery instructions. With multiple replicas verify invalidation, consistent builds/action configuration, and deployment skew. No selected target means pending target checks, not an invented provider.
Output: CI, selected runtime config, operational notes.
Gate: production artifact boots; actual provider configuration/cache topology need target evidence. O01–O03, O05–O08.

## Phase 10 — Verify and hand off

Run [verification gates](references/verification.md) using production builds, real browser, and real API where required. Cover sessions, direct route access, errors, duplicates, stale responses, reload, navigation, cache refresh, keyboard, and layouts. Read [optional profiles](references/optional-profiles.md) only for selected tenancy/realtime/upload/AI behavior; test it too.
Update evidence and run:
`node <skill-directory>/scripts/check-manifest.mjs <project>/scaffold-manifest.json`
First run the executable gate commands in the verification guide. This checker validates report consistency, not application correctness; it cannot replace those commands.
Output: working frontend, API/setup/feature/operations notes, versions, and evidence.
Gate: locally verified requires real integration; fixture-only results stay limited. Deployment verified requires G09.

## Completion response

Give the absolute project path, run commands, completed journey, actual checks/results, and unresolved API/deployment work. Distinguish generated, locally verified, and deployment verified; a build or skill installation is not production readiness.
