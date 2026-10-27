# Replacing the Projects example

Projects (signed-in owners create, list, read and rename their projects) exists to prove the stack end to end. Replace it with your first real feature; do not ship both.

The steps below were run on a freshly generated workspace. Afterwards every static gate command passed: `check:workspace`, `boundaries`, `format:check`, `check:secrets`, `check:docs`, `lint`, `check:arch`, `typecheck`, `build`, `test:unit`, `contract:check` and `check:budget`.

## Before you start

- **Prefer replacing to deleting.** Several platform tests (sign-in, rate limits, shutdown, tracing) use the example's protected route as their target. Step 5 lists them. Point them at your feature's route; do not delete them.
- **Has the API been released?** If no client has used it yet, you may reset the accepted contract (step 3) and delete the example migration (step 4). If it has, the example's operations and table are part of a released contract: deprecate them, version the API, and remove them in a later release instead.

## 1. Delete the files the example owns

```bash
git rm -r apps/api/src/projects apps/api/docs/features/projects.md \
  apps/api/test/projects-dto.unit.test.mjs apps/api/test/projects-service.unit.test.mjs \
  apps/web/src/features/projects apps/web/src/app/projects apps/web/docs/features/projects.md \
  apps/web/tests/projects.spec.ts
```

## 2. Edit the shared files that name it

| File | Change |
|---|---|
| `apps/api/src/app.ts` | Remove the `ProjectsModule` import and its entry in `imports`; import your module instead. Change the `setTitle('Projects reference')` text. |
| `apps/web/src/lib/feature-routes.mjs` | The only place shared web code names the feature. Set `homePath` (where sign-in lands), `privatePaths` (pages that need a session) and `operations` (names allowed in logs and traces). With no feature yet: `'/'`, `[]`, `[]`. |
| `apps/web/src/app/page.tsx` | It redirects to `homePath`. If `homePath` is `'/'`, replace it with a real page, or it redirects to itself. |
| `apps/web/src/app/layout.tsx` | Change the `Projects reference` title. |
| `apps/api/AGENTS.md`, `apps/web/AGENTS.md` | Remove or replace the link to `docs/features/projects.md`. `pnpm check:docs` fails on a broken link. |
| `apps/api/docs/architecture.md`, `apps/web/docs/architecture.md` | Describe your feature's files instead of the Projects ones. |

## 3. Regenerate and accept the contract

`contract:generate` needs no database or secrets.

```bash
pnpm contract:generate
pnpm contract:check
```

`contract:check` now reports the removed operations as breaking. That is correct. **Only for an unreleased API**, accept the new schema as the baseline and record why in `apps/api/docs/decisions.md`:

```bash
cp apps/api/openapi.json apps/api/contracts/accepted.openapi.json
cp apps/api/openapi.json packages/api-client/contract/accepted.openapi.json
pnpm contract:check
```

For a released API, keep the old baseline and follow the versioning decision instead. Never copy the baseline just to make the check pass.

## 4. Database

- **Unreleased:** delete `apps/api/migrations/001-projects.sql`. In `apps/api/test/migrations.test.mjs`, rewrite the test "database constraints reject rule-breaking writes" for your table: same idea, your columns and constraints. Add your feature's migration.
- **Released:** never edit or delete an applied migration; the runner rejects a changed checksum. Add a new migration that drops the table only after a backup and an explicit decision.
- `apps/api/scripts/recovery.mjs` checks the tables in `RECOVERY_TABLES` (default `projects`). Set your feature's tables.

## 5. Point platform tests at your feature

These run outside the static gate (they need PostgreSQL, a browser or the identity provider), so a green gate does not prove them. Each uses the example as a stand-in for "a protected route".

| File | Uses | Change to |
|---|---|---|
| `apps/api/test/api.test.mjs` | Projects HTTP behavior | Your feature's HTTP tests, keeping the same cases: validation, ownership, conflicts, problem details |
| `apps/api/test/identity.test.mjs` | `GET /v1/projects` with bad tokens | Any protected `GET` route of yours |
| `apps/api/test/limiter-http.test.mjs` | `GET /v1/projects` flood | Same route |
| `apps/api/test/runtime.test.mjs` | Slow `POST /v1/projects` upload (request timeout) | Any `POST` route of yours |
| `apps/api/test/with-web.mjs` | Waits for web `/projects` | `homePath` |
| `apps/api/scripts/collector.mjs`, `apps/web/scripts/collector.mjs` | Span name `projects.list` | One of your `operations` |
| `apps/web/scripts/runtime.test.mjs` | Fetches `/projects` for CSP nonces | Any page of yours |
| `apps/web/scripts/identity.test.mjs` | `returnTo` of `/projects/some-id` | Any same-origin path |
| `apps/web/tests/accessibility.spec.ts`, `apps/web/tests/form-regressions.spec.ts`, `apps/web/profiles/identity.spec.ts` | Projects pages and form labels | Your pages; keep each scenario (axe scan, pending/retry/conflict form states, sign-in round trip) |

## 6. Verify

```bash
pnpm check:workspace && pnpm boundaries && pnpm format:check && pnpm check:secrets && pnpm check:docs
pnpm lint && pnpm check:arch && pnpm typecheck && pnpm build && pnpm test:unit
pnpm contract:check && pnpm check:budget
```

Then run the database-backed and browser suites from `docs/operations.md` and the app docs. The removal is done only when those pass too.

## Adding your feature in its place

Copy the example's shape, not its rules. For each layer, keep the same kind of file and the same kind of test:

- **API:** module, controller, DTOs with strict validation, application service, migration with database constraints, problem-details errors. Tests: DTO validation (`*-dto.unit.test.mjs`), service rules (`*-service.unit.test.mjs`), HTTP behavior, migration constraints.
- **Web:** `src/features/<name>/` with `services` (typed API calls), `actions` (validated Server Actions), `hooks` (form state, the only caller of actions) and `components` (UI only), plus a public `index.ts`. Routes in `src/app/<name>/` import only that `index.ts`. `pnpm check:arch` enforces this.
- Decide ownership, deletion and retry rules from your product, not from Projects.
