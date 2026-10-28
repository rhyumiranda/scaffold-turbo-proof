# Workspace architecture

```text
apps/api                   Nest standard-mode deployable
apps/web                   Next deployable
packages/api-client        checked-in OpenAPI and generated browser-safe types
packages/eslint-config     shared flat configs with framework-specific exports
packages/typescript-config shared base, Nest, and Next presets
```

## Boundaries

- Applications are leaves. Libraries never depend on applications. Three gates enforce it in CI: the shared ESLint `crossAppPatterns` rule, each app's `check:arch`, and `pnpm boundaries` (`turbo boundaries` with the `app` tag). No single gate is trusted alone.
- Web never imports API source, Nest providers, ORM/database code, or server credentials.
- API never imports web source.
- Internal imports use declared `workspace:*` dependencies and package exports, never cross-package relative paths or root TypeScript aliases.
- Nest owns persistence, authorization, validation, and business rules.
- The initial shared runtime surface is types only. Do not add `shared`, `common`, `utils`, `ui`, or `database` packages without an actual second consumer and a clear owner.
- Keep Nest in standard mode. Turborepo/pnpm own the workspace; do not create a nested Nest CLI monorepo.
- Preserve framework module differences. Shared TypeScript configuration centralizes safe common flags but keeps Nest emit/decorator and Next bundler/JSX settings separate.

## Request paths

```text
Server read: Server Component → server-only service → Nest API
Client read when needed: component → hook → browser service → Next GET handler → server-only service → Nest API
Client mutation: client component/form → hook → Server Action → server-only service → Nest API. The hook is mandatory and is the only client file that imports the action.
Server form: Server Component `<form action>` with no client state → Server Action → server-only service → Nest API
```

Do not add CORS by default. Add direct browser-to-Nest transport only for a selected requirement and then configure origins, credentials, CSRF, caching, and tests deliberately.

## Contract ownership

Nest `apps/api/openapi.json` is authoritative. `pnpm contract:generate` intentionally synchronizes it to `packages/api-client/contract/openapi.json` and regenerates types. Ordinary build and install commands never mutate contract files. `pnpm contract:check` proves all checked-in copies and types agree and runs compatibility guards.
