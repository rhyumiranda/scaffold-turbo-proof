# Reproducible checks

Use Node 24.22.1 and pnpm 12.15.0. Run workspace gates from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm contract:check
pnpm check:budget
```

Unit checks cover architecture boundaries, logging redaction, bundle budgets, contract compatibility, and install policy. Runtime checks boot real compiled artifacts. They do not replace database-backed integration.

## Workspace integration

The committed bootstrap connects this frontend to `apps/api`; no external project path is needed. Use only a confirmed disposable PostgreSQL database:

```sh
DATABASE_URL=postgresql://test_user@127.0.0.1:5432/test_database NODE_ENV=test pnpm test:integration
pnpm --filter @repo/web exec playwright install chromium
DATABASE_URL=postgresql://test_user@127.0.0.1:5432/test_database NODE_ENV=test pnpm test:e2e
```

The harness applies reviewed migrations, creates short-lived local test identities, starts the real API and production Next server, runs the pinned Playwright CLI, and closes owned processes. It rejects missing infrastructure. Never use shared or production credentials.

The CSP browser check injects an unnonced parser script into the real server response. It requires a browser policy violation, denied script execution, and a working form.

The API contract is checked from `packages/api-client/contract/openapi.json`. Do not overwrite `accepted.openapi.json` merely to make CI green; review consumer and version compatibility before accepting a new baseline.
