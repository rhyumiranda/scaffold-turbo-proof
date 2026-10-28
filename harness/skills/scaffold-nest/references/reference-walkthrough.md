# Executable Nest reference — read before scaffolding

Start from [assets/reference](../assets/reference), not a fresh interpretation of the prose. Use the safe [generator](../scripts/scaffold.mjs). It copies a locked, executable API and refuses any existing destination. It installs nothing, commits nothing, and deploys nothing.

## Exact starting commands

```bash
node <skill-directory>/scripts/scaffold.mjs --destination /absolute/new-api --name my-api --dry-run
node <skill-directory>/scripts/scaffold.mjs --destination /absolute/new-api --name my-api
cd /absolute/new-api
# Select Node 24.22.1 with the user's runtime manager first.
npm ci
npm run lint
npm run check:secrets
npm run check:arch
npm run typecheck
npm run build
npm run test:unit
npm run contract:check
npm run contract:compat
```

Use a dedicated disposable PostgreSQL database. Supply DATABASE_URL through the environment, without printing it. For API tests:
```bash
NODE_ENV=test npm test
```
Tests run migrations and start a local test issuer, verify actual signed JWTs, and stop the API/issuer. They do not contact a real identity provider. Never point them at a shared or production database.

For a real runtime, supply AUTH_ISSUER, AUTH_AUDIENCE, AUTH_JWKS_URL and DATABASE_URL. Set WEB_ORIGIN only for the selected browser transport. Run npm run migrate (prisma migrate deploy), npm run contract, and npm start. Identity endpoints must be HTTPS except loopback in NODE_ENV=test. No signing keys or production login bypass are included.

## Phase-to-file map

| Phase | Copy/read these exact files | Required behavior |
|---|---|---|
| 1 Contract | package.json, .env.example; complete the feature contract | Explicit access, operations, auth/deployment seams |
| 2 Foundation | tsconfig.json, src/platform/config.ts, projects/module.ts, platform/module.ts, scripts/check-architecture.mjs, AGENTS.md, docs/ | Strict types; startup validation; executable feature boundaries; project-local knowledge |
| 3 Data | prisma.config.ts, prisma/schema/, prisma/migrations/0001_projects/migration.sql, scripts/migrate.mjs, src/platform/database.ts, src/projects/repository.ts, test/migrations.test.mjs | Prisma 7 multi-file schema per module; no foreign keys; constraints in migration SQL; prisma migrate deploy with an edited-history check; clean/upgrade/failed-rollback/concurrency/drift tests; pool budgets |
| 4 Identity | src/platform/auth.ts | Verify RS256 signature, issuer, audience, subject, exp and iat |
| 5 HTTP | src/projects/dto.ts, controller.ts, src/platform/errors.ts, test/schema.mjs, scripts/check-contract.mjs | Integer schemas, documented errors, actual response assertions, regeneration and accepted-contract checks |
| 6 Feature | src/projects/service.ts | Create/list/read/rename; owner predicate on every read/write |
| 7 Correctness | projects/service.ts rename; platform/deadline.ts; test/api.test.mjs | One version-update winner; bounded requests; no automatic unsafe mutation retry |
| 8 Runtime | src/platform/health.ts, shutdown.ts, logging.ts, telemetry.ts; test/runtime.test.mjs | DB readiness; request/trace correlation; portable metrics; tested signal/drain/deadline/redaction behavior |
| 9 Delivery | .github/workflows/verify.yml, Dockerfile | Locked build; gated checks; non-root image; no deployment |
| 10 Evidence | test/api.test.mjs; test/with-web.mjs if web integration requested | Actual HTTP/database/browser behavior, not mocks |

## Concrete contract and expected failures

Create with a valid identity:
```http
POST /v1/projects
Authorization: Bearer <provider-issued access token>
Content-Type: application/json

{"name":"Launch"}
```
Expected 201 and only:
```json
{"id":"<uuid>","name":"Launch","version":1,"createdAt":"<ISO timestamp>"}
```
No owner_id, credentials, or internal fields are returned.

| Request | Expected |
|---|---|
| Missing, invalid, or expired bearer token | 401, code UNAUTHENTICATED |
| Create {"name":" "} | 400, code INVALID_INPUT |
| Create {"name":"Launch","owner_id":"someone-else"} | 400, never ownership override |
| GET /v1/projects?limit=101 | 400 |
| Read another user's UUID | 404, never the record |
| Rename another user's UUID | 404 |
| PATCH same owned UUID twice concurrently with expectedVersion:1 | Exactly one 200 and one 409 |
| Rename with stale expectedVersion | 409, code VERSION_CONFLICT |
| Missing record or invalid UUID | 404 or 400 respectively |

Conflict response shape:
```json
{"type":"about:blank","title":"Conflict","status":409,"code":"VERSION_CONFLICT","requestId":"<uuid>"}
```

The invariant is in this real SQL pattern, not a comment:
```sql
UPDATE projects
SET name=$3, version=version+1
WHERE id=$1 AND owner_id=$2 AND version=$4
RETURNING id, name, version, created_at;
```
Do not replace it with an unprotected read-then-update or remove owner predicates during renaming/adaptation.

## Allowed adaptation and preserved invariants

Rename the example resource and change fields/operations to the agreed domain. Adapt constraints, DTOs, OpenAPI, tests, and migrations together. User ownership is an example policy; replace it with the actual access rule, never with no rule. Deletion is intentionally absent.

Preserve runtime validation, safe output mapping, authenticated resource access, parameterized queries, concurrency guarantees, deadlines, and negative tests. Choosing Prisma, another provider, or another protocol is an explicit profile change requiring equivalent tests; it is not an unverified drop-in substitution.

## Known boundaries — finish during the phases

- JWT verification is implemented; choosing and configuring the real identity provider is not.
- Test identities exist only in test files; no test issuer is imported by src.
- The limiter defaults to memory for one process. LIMITER_MODE=redis selects the shipped shared limiter; test:profiles exercises two actual API instances. Read [runtime profiles](production-profiles.md); actual proxy/topology and capacity still require target evidence.
- Local signal/drain/deadline tests and tracing/metrics exist. Configure the actual collector, restricted telemetry access/retention, alert ownership, load targets, restore drills, and deployment shutdown evidence separately.
- No payment, tenancy, jobs, AI, or generalized durable idempotency is implied.
- Container/workflow configuration is supplied; cloud deployment and hosted workflow execution have not been performed.
- Keep API logs to safe fields; tracing and additional data retention need a deliberate policy.

## Failure fixtures and adaptation

Run test:unit before and after extending features. Its architecture and contract fixtures intentionally violate boundaries; they must keep failing inside their negative assertions. Run test:integration and test:runtime with a confirmed disposable database. Those prove more than a compile: actual ownership, migration rollback, timeout, dependency loss, and bounded process exit.

For a new domain, change the DTOs, constraints, operations, schema/client, test requests and expected persisted state together. Keep the same negative invariants. Establish the new initial accepted schema only for a genuinely new/unreleased API; existing consumers require an explicit compatibility decision.

Use the generated AGENTS.md and docs as the handoff, not this external skill directory. Run the skill's verify.mjs gates to record command evidence in the new project's manifest.
