# API project guide

Read [architecture](docs/architecture.md), then the [projects flow](docs/features/projects.md). Commands and failure handling are in [operations](docs/operations.md); consequential choices are in [decisions](docs/decisions.md).

- Keep feature ownership in its Nest module; import another feature only through its public index. Platform never imports features. Run `npm run check:arch` after moving imports.
- Read [security verification](docs/security-verification.md); run `npm run check:secrets` and `npm run check:docs` before handoff.
- Preserve actor predicates and atomic version checks when adapting the sample. Authentication is not resource permission.
- Never log tokens, database URLs, raw request URLs/bodies, SQL text/values or exception messages. Use safe error categories and trace/request IDs.
- Data access is Prisma ORM 7. Each module owns its models in `prisma/schema/<module>/` and touches only those (through its private repository); other modules' data comes through their services. No foreign keys, no cross-module relations. See [architecture](docs/architecture.md#data-ownership-modular-monolith).
- Schema/data administration goes through reviewed SQL migrations in `prisma/migrations/`, written with `prisma migrate diff` and applied only with `npm run migrate` (`prisma migrate deploy`). Never use `prisma migrate dev`, `prisma migrate reset` or `prisma db push`, and never edit an applied migration.
- Run `npm run build` before tests. Use NODE_ENV=test and a confirmed disposable DATABASE_URL; integration tests write through API operations and per-test schemas migrated with `prisma migrate deploy`.
- Changing DTOs requires schema export, response validation and accepted-contract review together; tell consumers to regenerate their clients. Never refresh the accepted baseline merely to turn a failing check green.
- Generated files are not deployment evidence. Real identity-provider configuration, target credentials, limiter sharing, recovery and capacity remain explicit project work.
