---
name: scaffold-turbo-nest-next
description: Scaffold and verify a production-oriented pnpm/Turborepo workspace that composes the installed scaffold-nest and scaffold-next references. Use for a new combined NestJS API and Next.js frontend foundation, not ordinary feature edits, framework-only projects, or deployment unless requested.
metadata:
  short-description: Compose Nest and Next in Turborepo
---

# Scaffold Nest + Next Turborepo

Build the requested workspace, not a plan. This skill owns repository composition, package boundaries, the task graph, contract synchronization, and combined verification. `scaffold-nest` owns API behavior; `scaffold-next` owns frontend behavior.

## Operating contract

- First read [reference walkthrough](references/reference-walkthrough.md), [intake](references/intake.md), and [companion compatibility](references/companion-compatibility.md). Generate with `node <skill-directory>/scripts/scaffold.mjs --destination /absolute/new-repository --name repository-name`; add `--dry-run` for a no-write preview.
- Require the installed `scaffold-nest` and `scaffold-next` executable references. Stage them outside the destination, validate their manifests, and adapt only tested reference versions. Never run their standalone generators directly into `apps/`.
- Read [architecture](references/architecture.md) before changing package structure or imports; [tasks, cache, and environment](references/tasks-cache-env.md) before task changes; [verification](references/verification.md) before checks.
- Use [requirements](references/requirements.md) to track applicability and evidence. Check version-sensitive decisions against [sources](references/sources.md). Recommendations are defaults, not vendor mandates.
- Preserve the companion references' security, authorization, concurrency, input-preservation, accessibility, recovery, and production-runtime tests. A successful standalone check does not prove the adapted workspace.
- Default to pnpm, one root lockfile, Nest standard mode in `apps/api`, Next in `apps/web`, and explicit internal packages. A different package manager or nested framework workspace is an adaptation requiring equivalent evidence.
- Keep applications independently deployable. Nest owns business/data decisions. Next never imports API source or database code. The generated browser-safe API client is the only initial cross-application code package.
- Scaffolding does not authorize commits, publishing, deployment, billing, production writes, or remote-cache enrollment. Direct database inspection stays read-only; schema/data changes use migrations.

## Phase 1 — Establish the workspace contract

Resolve destination, repository name, actors and journey, auth/database choices, package manager override, runtime target, deployment intent, and optional capabilities. Recover settled decisions before asking. Preview exact files, versions, transformations, and side effects.

Output: an intake JSON file passed to the generator with `--intake`, recorded in the composite manifest.

Gate: no silent guess about destination conflicts, identity, record access, deletion, or deployment.

## Phase 2 — Validate companion references

Locate the installed companion skills, check their executable generators, and require versions listed in the compatibility reference. Generate both into isolated staging directories and validate their source manifests before adaptation.

Output: verified staged API and web references with provenance.

Gate: unknown companion versions, missing manifests, symlinks, or failed reference checks stop composition.

## Phase 3 — Generate the workspace foundation

Create the locked root reference: private root package, exact pnpm and runtime contract, one workspace definition and lockfile, Turborepo task graph, root CI, repository instructions, and shared configuration packages. Refuse existing destinations and interrupted reruns.

Output: valid pnpm workspace and root tooling.

Gate: frozen install and workspace discovery pass. F01–F08.

## Phase 4 — Adapt applications without weakening them

Copy application-owned files from staging through the deterministic adapters. Remove standalone lockfiles/root ownership, replace npm-only commands and install-policy fixtures, apply workspace package names/configuration, and keep each application private. Re-run the application checks in workspace context.

Output: `apps/api` and `apps/web` as independently runnable workspace packages.

Gate: no nested lockfile, package-manager declaration, workflow, Git root, or cross-app source import remains. C01–C12, B01–B13.

## Phase 5 — Establish the executable API contract

Keep Nest OpenAPI authoritative. Create `packages/api-client` with the checked-in schema and generated browser-safe types. Make regeneration explicit and mutating; make drift/compatibility checks deterministic and non-mutating. Next imports types only from the package.

Output: reviewed schema, generated client, sync command, and drift gate.

Gate: API metadata, checked-in API schema, client schema, and generated types agree. I01–I15.

## Phase 6 — Configure tasks, cache, and environment

Declare actual outputs and dependencies. Keep development persistent/uncached; keep migrations, generation, E2E, and other side effects uncached. Use strict environment mode, application-local examples, explicit hashing, and safe passthrough only for output-neutral variables.

Output: explainable task graph and cache policy.

Gate: second build restores outputs; dependency, source, contract, and environment changes invalidate only affected work. T01–T16, E01–E12.

## Phase 7 — Verify the combined journey

Use a disposable database and synthetic short-lived identities. Build both apps, start the compiled Nest API and compiled Next frontend, then run the real browser journey. Verify persistence after reload, authorization, validation, conflicts, repeated actions, recovery, keyboard behavior, and layouts.

Output: full-stack evidence, not fixture-only UI results.

Gate: real web → API → database journey passes; missing infrastructure is blocked, never skipped to green. Q01–Q15.

## Phase 8 — Add CI and selected packaging

Run frozen installs and required gates in CI. Keep affected checks as an optimization, not the release proof. Both pruned Dockerfiles are always generated and built in CI as local packaging; `intake.deployment` records whether they will ship. Run migrations as a controlled release step.

Output: CI and target-appropriate packaging.

Gate: local production artifacts boot and smoke tests pass. Provider claims require provider evidence. D01–D15.

## Phase 9 — Verify provenance and rerun safety

Record companion versions, source/result checksums, commands, observed results, selected profiles, and blocked reasons. Run the executable commands in [verification](references/verification.md), then run `node <skill-directory>/scripts/check-manifest.mjs <repository>/scaffold-manifest.json`.

Output: composite evidence report and durable project instructions.

Gate: the checker confirms report consistency only; it never substitutes for commands or browser/database evidence.

## Completion response

Give the absolute repository path, run commands, package graph, completed journey, actual checks/results, and unresolved auth/database/deployment work. Distinguish generated, locally verified, and deployment verified.
