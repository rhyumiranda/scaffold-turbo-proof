# Executable combined reference

Generate from the companion executable references through the safe adapter:

```bash
node <skill-directory>/scripts/scaffold.mjs --destination /absolute/new-repo --name my-product --dry-run
node <skill-directory>/scripts/scaffold.mjs --destination /absolute/new-repo --name my-product
cd /absolute/new-repo
pnpm install --frozen-lockfile
pnpm check:workspace
pnpm lint
pnpm check:arch
pnpm typecheck
pnpm build
pnpm test:unit
pnpm contract:check
pnpm audit --audit-level=high
```

The generator installs nothing and performs no network, Git, database, deployment, or remote-cache action. It stages the two companions in the system temporary directory, validates the Nest `1.3.3` and Next `1.3.4` manifests, adapts them, writes the locked root reference, records the composite manifest, and removes staging.

## File ownership

| Owner | Files |
|---|---|
| workspace | root package/lock/workspace/Turbo config, root CI, root docs, Docker orchestration |
| Nest companion | `apps/api/src`, migrations, API tests, feature/operations docs |
| Next companion | `apps/web/src`, web scripts/tests, UI/operations docs |
| adapter | app package names/scripts/config entrypoints, pnpm install-policy fixtures, workspace Dockerfiles, contract package |
| API client package | checked-in OpenAPI, accepted baseline, generated types, drift/compatibility scripts |

## Contract flow

```text
apps/api source
  → compiled Swagger metadata
  → apps/api/openapi.json
  → packages/api-client/contract/openapi.json
  → packages/api-client/src/api.d.ts
  → apps/web type-only import
```

`pnpm contract:generate` is the only normal command that mutates the synchronized client contract. `pnpm contract:check` regenerates to temporary space and compares without writes.

## Full-stack flow

After a disposable PostgreSQL database is available:

```bash
NODE_ENV=test pnpm test:integration
NODE_ENV=test pnpm test:runtime
pnpm --filter @repo/web exec playwright install chromium
NODE_ENV=test pnpm test:e2e
```

The E2E harness starts a local JWT issuer, migrates the disposable database, starts compiled Nest and Next runtimes, creates short-lived identities, runs Playwright, and cleans up owned processes.

## Known boundaries

- Real provider login/refresh/logout remains unresolved until selected.
- Database tests require a confirmed disposable PostgreSQL URL.
- Dockerfiles are supplied but deployment remains unverified until built and tested for the selected target.
- Remote caching is not configured.
- The Projects feature is removable example behavior, not a universal product domain.
