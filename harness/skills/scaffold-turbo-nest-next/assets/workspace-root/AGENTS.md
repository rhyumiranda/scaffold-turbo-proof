# Workspace instructions

- Read `docs/architecture.md`, then the nearest app or feature guide.
- Use pnpm 12.15.0 and Node 24.22.1. Keep one root lockfile; install dependencies in the package that imports them.
- Keep Nest and Next deployable independently. Applications never import each other's source; `pnpm lint`, `pnpm check:arch` and `pnpm boundaries` each fail on a cross-app import.
- Route every client-component mutation through a hook; only the hook imports the Server Action. `check:arch` fails otherwise.
- Nest owns authorization, data, and business decisions. Web imports browser-safe API types only from `@repo/api-client`.
- API data uses Prisma ORM 7: each API module owns its models in `apps/api/prisma/schema/<module>/`, no foreign keys, other modules' data only through their services (`pnpm check:arch` enforces it). Schema changes are committed SQL in `apps/api/prisma/migrations/`, applied only by `pnpm migrate` (`prisma migrate deploy`); never `prisma migrate dev`, `prisma migrate reset` or `prisma db push`.
- Run `pnpm contract:check` after API changes. Use `pnpm contract:generate` only when intentionally reviewing a contract/client update.
- Use a confirmed disposable database for integration/E2E tests. Never run them against shared or production data.
- Run `pnpm check:workspace`, `pnpm boundaries`, `pnpm lint`, `pnpm check:arch`, `pnpm typecheck`, `pnpm build`, `pnpm test:unit`, and `pnpm contract:check` before handoff.
- Do not claim provider, remote-cache, container, or deployment verification without target evidence.
- Projects is a removable example. Replace it with the first real feature by following `docs/replacing-the-example.md`.
