# Verification

Run from the generated repository with Node 24.22.1 and pnpm 12.15.0.

## Gates recorded in `scaffold-manifest.json`

Each gate is `not_run`, `passed`, `failed` or `blocked`, with evidence paths. A gate passes only on observed command output from this generated repository.

| Gate | Required evidence |
|---|---|
| G01 Safe generation | Dry run writes nothing; invalid names, traversal and existing destinations are refused; staged companion manifests and versions match; the bundled lockfile matches every package |
| G02 Reproducible build | The generated-structure sequence below passes, including `pnpm boundaries` |
| G03 Working application | Compiled API with a real disposable database, plus compiled web against that API with persisted state after reload (`pnpm test:e2e`) |
| G04 Security boundary | Real identity provider, missing/forged/expired credentials, direct calls, cross-user access, minimized outputs. Synthetic issuers keep G04 `blocked` |
| G05 State correctness | Persistence after reload, conflicts, failed mutations keeping input, repeated requests, cache and navigation behavior |
| G06 Optional profiles | Each selected companion profile (identity, replicas, Redis limiter, telemetry, recovery) has its own passing evidence |
| G07 Runtime | Both apps: config rejection, health transitions, SIGTERM with bounded exit, safe diagnostics (`pnpm test:runtime`) |
| G08 Cache correctness | Second build is a full cache hit, deleted outputs are restored, and editing one app misses only that app's tasks |
| G09 Deployment | Authorized real-target build, migration, rollout, health and recovery evidence; otherwise `not_run` |

`requirements` in the manifest lists every ID from `references/requirements.md` with the same statuses. `check-manifest.mjs` rejects a missing or unknown ID.

## Generated-structure gates

```bash
pnpm install --frozen-lockfile
pnpm check:workspace
pnpm boundaries
pnpm check:secrets
pnpm check:docs
pnpm lint
pnpm check:arch
pnpm typecheck
pnpm build
pnpm test:unit
pnpm contract:check
pnpm check:budget
pnpm audit --audit-level=high
```

## Runtime gates

With `DATABASE_URL` pointing to a confirmed disposable PostgreSQL database:

```bash
NODE_ENV=test pnpm test:integration
NODE_ENV=test pnpm test:runtime
pnpm --filter @repo/web exec playwright install chromium
NODE_ENV=test pnpm test:e2e
```

Do not run database tests against shared or production data. Authentication tests use a local issuer and short-lived synthetic identities.

## Cache gates

```bash
pnpm build
pnpm build
pnpm exec turbo run build --dry=json
```

Record actual cache hits and verify restored output boots. A printed graph alone does not prove cache correctness.

## Delivery gates

When containers are selected and Docker is available, build both root-context Dockerfiles, run the API migration target against a disposable database, start each runtime image as non-root, and execute smoke/full-stack tests. Without this evidence, packaging remains unverified.

## Evidence levels

- `generated`: deterministic files and a consistent manifest exist.
- `locally_verified`: frozen install, static/build/unit/contract checks, real database tests, and real browser integration pass.
- `deployment_verified`: locally verified plus actual target build, migration, rollout, health, cache topology, and recovery evidence.
