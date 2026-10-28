# Tasks, cache, and environment

## Baseline graph

- `build`: dependency builds first; cache `dist/**` and `.next/**`, excluding Next caches/dev output.
- `lint`, `typecheck`, `check:arch`, `check:docs`, `check:secrets`: non-mutating and cacheable.
- `test:unit` and `contract:check`: depend on the same package's build; cache only deterministic results.
- `test:integration`, `test:runtime`, `test:e2e`: uncached because they use processes, ports, databases, or browser state.
- `dev`: persistent, interruptible, and uncached.
- `migrate`, `contract:generate`, seed, deploy, and publish: uncached side effects and never build dependencies.

Declare dependencies because they are real, not to serialize everything. Keep default tracked-file inputs unless a narrower set is proven correct. Custom inputs retain `$TURBO_DEFAULT$`.

## Environment

- Keep strict environment mode.
- Put `.env.example` and ignored local `.env*` files in the application that consumes them.
- Hash variables that change outputs. Pass through output-neutral CI/browser location variables only where needed.
- Never place secret values in `turbo.json`, examples, source, logs, manifests, or cache diagnostics.
- Remote caching is optional. If selected, sign artifacts and prevent untrusted jobs from writing caches later restored by trusted jobs.

## Cache validation

Run a clean build twice, delete outputs, and confirm cache restoration. Separately change API source, web source, the API contract, each configuration package, and build-affecting environment variables. Confirm the task graph misses only work that can change.

## Web build variables

`apps/web/turbo.json` hashes `APP_DEPLOYMENT_ID`, `DEPLOYMENT_REPLICAS` and `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` into `web#build`. `next.config.ts` reads them through `deploymentSettings()`, and they change the build output, so a change must miss cache. Turborepo stores only a hash of each value, never the value.
