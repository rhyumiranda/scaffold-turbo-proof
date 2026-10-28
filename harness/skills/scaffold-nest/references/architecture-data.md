# Backend architecture and data

Read before phases 2–6. Apply catalog F, N, and D, with applicability recorded rather than indiscriminate infrastructure.

## Module ownership

Organize by domain feature, with explicit exports. Controllers translate HTTP; application operations own decisions; persistence/integration code handles external concerns. Start with one modular application. Do not force microservices, CQRS, event sourcing, repository interfaces, or domain objects around trivial CRUD. Introduce an abstraction to isolate real behavior or a replaceable dependency.

A useful initial shape:
```text
src/<feature>/            module, controller, DTOs, operations, index.ts public surface
src/platform/             configuration, identity, database, health, logging
migrations/               reviewed migration artifacts, or ORM equivalent
test/                     HTTP and real-dependency integration tests
docs/                     architecture, decisions, feature and operations guides
```
Keep features flat under `src/`: `scripts/check-architecture.mjs` treats the first folder under `src/` as the owner. A `src/modules/` wrapper would make every feature one owner and silently disable the cross-feature check. Create folders only when used. Keep per-caller credentials/identity out of singleton fields. Use explicit request context; avoid unnecessary request-scoped graphs. Workers, if selected, reuse backend operations rather than duplicate rules.

## Configuration and verification commands

Validate required environment values before serving requests. Separate development/test/production configuration and use names that match actual targets; a “dev” command must never load production settings. Missing settings fail safely without printing values. Separate lint checking from lint fixing. CI must execute type checks even if compilation uses a transpiler that does not type-check.

Supply reproducible frozen-install, lint, type-check, unit, integration, contract, build, and production-start commands. Avoid implicit destructive lifecycle scripts. Record build-time/runtime environment needs and runtime/package-manager versions.

## HTTP contracts

Validate body, path, query, and relevant headers; bound lengths, arrays, page size, and filter complexity. Define explicit coercion, especially booleans/numbers. Proposed default: reject unexpected writable properties. With Nest ValidationPipe, whitelist plus forbidNonWhitelisted supports this; validate decorator/schema coverage. [Validation](https://docs.nestjs.com/techniques/validation)

Map responses explicitly. Password hashes, tokens, private flags, internal database fields, and provider internals do not belong in output. Stable errors should have safe codes, status, field detail when useful, and request correlation; RFC 9457 is a recommended envelope. Never expose stack traces or reflect raw upstream messages.

Use deterministic ordering and bounded pagination with indexes appropriate to actual access. Generate OpenAPI and test actual responses, errors, security schemes, and nullability against it. The exported contract is `openapi.json`; a consumer generates its own browser-safe types from it. Never make Nest classes or ORM entities the cross-application contract.

Run contract:check for runtime/schema agreement and contract:compat against the accepted schema; regeneration alone proves neither. When replacing the removable example in a brand-new, unreleased project, establish the initial accepted schema from the agreed feature contract and record that decision. For an existing/released API, do not replace the accepted baseline merely to silence a breaking-change failure; use an authorized versioning/migration plan. Keep the negative compatibility fixtures in either case.

## Persistence and migrations

State business invariants before schema design. Enforce meaningful foreign keys, uniqueness, nullability and checks at the database. Define timestamp/time-zone serialization, precision/currency rules, large identifiers, nullable fields, and deletion/retention behavior.

Use transactions for related writes; avoid holding locks while calling external providers. Choose conditional updates, version checks, isolation, or locks according to the invariant. Test two competing operations; a transaction alone does not prove race safety. Bound query durations and pool sizes across all processes/replicas; inspect representative data plans, not only empty fixtures.

User policy: direct agent SQL/database inspection is read-only. Administrative schema/data changes use reviewed migration files. Normal runtime operations and integration tests call application behavior; they do not become permission to run ad-hoc administrative writes against shared data.

If Prisma is selected:
- Never use migrate dev, migrate reset, or db push, even as a quick local setup shortcut.
- Verify the exact pinned CLI's supported migration-authoring/diff workflow, or author reviewed migration SQL explicitly.
- Apply migrations using prisma migrate deploy with an explicitly verified target.
- Do not pipe generated SQL directly into a database.
- Use dedicated disposable databases and migrations for test setup; avoid destructive shared-database teardown.

Test first install and upgrades from a prior supported schema. Coordinate one migration application step in delivery. For incompatible changes use expand/backfill/switch/contract; document old/new binary compatibility. An application rollback cannot undo a destructive migration. Backups need retention/access/encryption policy and measured restore evidence on the actual target.

## Feature scope

A reusable scaffold supplies engineering controls, not domain decisions. For inventory, a stock decrement needs an invariant; for bookings, reservation competition needs explicit behavior; for approvals, allowed transitions and actors matter. Do not infer these from a table. Implement the agreed slice and its negative cases, not a speculative product.
