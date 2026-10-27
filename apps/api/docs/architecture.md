# Architecture

`src/app.ts` composes `ProjectsModule`, `PlatformModule` and the rate limiter. `src/main.ts` initializes telemetry before loading application modules and owns process termination.

Authentication is a global guard: new endpoints fail closed unless deliberately marked Public. Only health checks are public in this reference. Object authorization remains inside the feature's owner-scoped operations; being authenticated alone never grants another user's record.

`src/projects/` owns controller, input/output DTOs, application operations and its module. Its public index exports the module only. Controllers translate HTTP; services decide owner-scoped reads and conditional writes. `src/platform/` owns identity, database, config, health, request deadlines, logs and telemetry. Platform never imports a feature.

The TypeScript-AST architecture check resolves local imports/exports, rejects private cross-module imports, direct feature database/transport dependencies, computed imports and cycles. Negative fixtures prove these failures. New path aliases or execution systems require extending the checker, not bypassing it.

Database calls use parameterized SQL. Related multi-statement business writes need an explicit transaction before that feature is added; this example uses single-statement atomic writes. A pool has at most five connections; aggregate replicas and migration processes when setting the server budget.

HTTP header arrival is bounded by five seconds, body arrival by ten seconds, and application middleware enforces one six-second budget from receipt of headers through response. Within that budget, JWKS is two seconds, PostgreSQL statements three seconds, client query waits four seconds, and controller work at most five seconds or the remaining budget. A timed-out mutation may have committed: never automatically replay it. HTTP cancellation does not promise SQL cancellation; PostgreSQL's statement timeout bounds remaining work.

OpenAPI is generated from explicit Swagger DTOs and errors. `contract:check` checks integer semantics and response-schema validation; integration tests validate actual success/error bodies. `contract:compat` compares existing operations to the last reviewed accepted schema, resolving references. It intentionally rejects semantic changes even if some are backward-compatible, while allowing new endpoints. Unsupported cyclic/external references fail closed and need a reviewed checker upgrade. It is a conservative compatibility guard, not a complete OpenAPI semantic-diff engine.
