# Validation — reference 1.3.3 (2026-10-27)

These are local checks of the bundled reference. They are not evidence for a generated or adapted project. Every project needs its own runs; never copy these results into its manifest.

## Evidence for 1.3.3

Fresh generation on macOS arm64, Node 24.22.1, npm 11.17.0, and a disposable PostgreSQL 15 database whose name ends in `_test`.

| Check | Result |
|---|---|
| Frozen install, `format:check`, `lint` (whole project, zero warnings), `check:arch`, typecheck, secrets, docs, build | pass |
| Unit tests | 18 pass |
| Contract tests, `contract:compat` | 4 pass, pass |
| Migrate, integration, runtime, telemetry | pass; 10, 7 and 1 tests |
| `npm ci` on Node 26 | refused (EBADENGINE), as intended |
| DB guard with a database named `app` | refused, as intended |
| Skill generator, manifest and verifier tests | 20 pass |

## Evidence carried from earlier versions (not rerun for 1.3.3)

| Check | Last passed | Note |
|---|---|---|
| Redis limiter profiles (`test:profiles`) | 1.3.0 | 3 tests, two API instances sharing quotas |
| Logical restore drill (`test:recovery`) | 1.3.0 | restored through migrations into a new cluster |
| Independent adaptation by a fresh agent | 1.3.0 | Notes API/web; all executable gates passed |

## Not verified

- Docker image build, start and shutdown (`test:container`): no Docker daemon was available.
- A real identity provider. Synthetic JWT issuers keep gate G04 blocked.
- Hosted CI, target TLS and proxies, rollouts, capacity, backup RPO/RTO, alert delivery.

## Version history

- 1.4.0: acceptance-round fixes. Named configuration errors; JSON logs with time, level, service and event on every line; transient database errors become 503 problems with `Retry-After`; 415 for non-JSON bodies and 400 for JSON nested deeper than 32; rate limits keyed on the verified user; `Cache-Control: no-store` on `/v1`; full contract compatibility classifier; migration errors name the file; restore drill pinned to UTC and the C locale; database-backed tests refuse non-`_test` databases; contract export needs no secrets; example-owned tests renamed `projects-*`.
- 1.3.3: RFC 9457 errors with a shared `ProblemDetails` schema; whole-project lint and Prettier; `typescript-eslint` 8.72.1, `@nestjs/swagger` 12.0.5; CI actions v7; TypeScript 5.9 decision recorded.
- 1.3.2: `/v1` URI versioning; disposable-database guard; `engine-strict`; version-range check in `verify.mjs`.
- 1.3.1: compatibility check sees properties named like documentation keywords; no promised client.
- 1.3.0: runtime profiles (OIDC, replicas, Redis limiter, telemetry, recovery, container, load) with evidence rules.
- 1.2.1: integer-range and parser-error corrections; ASVS evidence plan; secret scanning.
- 1.1: first executable reference with generator, manifest and verifier.
