# Architecture

`apps/api` is the authoritative Nest API and database boundary. `apps/web` is a server-first Next frontend. They communicate through HTTP; neither imports the other's source.

`packages/api-client` owns checked-in browser-safe OpenAPI types generated from the API contract. `packages/eslint-config` and `packages/typescript-config` share tooling policy while preserving framework-specific behavior.

Applications are leaves of the package graph. `pnpm lint`, `pnpm check:arch` and `pnpm boundaries` each fail when one app imports another app's package or source. Do not add generic shared, UI, or database packages without a real consumer and explicit ownership. Direct browser-to-API requests and CORS are not enabled by default; browser mutations use server entrypoints and server reads call the API through server-only services.
