# Validation — composite 1.3.0 (2026-10-27)

Tested matrix: `scaffold-nest` 1.3.3, `scaffold-next` 1.3.4, Node 24.22.1, pnpm 12.15.0, Turborepo 2.11.10. These are local checks of the bundled reference, not evidence for a generated project.

## Evidence for 1.3.0

Fresh generation with an `--intake` file, on macOS arm64 with a disposable PostgreSQL 15 database whose name ends in `_test`.

| Check | Result |
|---|---|
| Frozen install, `format:check`, `check:workspace`, `boundaries`, secrets, docs, audit | pass |
| Lint (zero warnings), `check:arch`, typecheck, build, unit tests | 11 tasks pass |
| `contract:check` (drift, sync, compat) | 9 tasks pass |
| Migrate, then API integration and web integration | 10 tests, then 17 Chromium tests |
| Runtime tests | API 7, web 2 |
| `test:e2e` through Turbo | 17 Chromium tests |
| Second build | full cache hit |
| Manifest | consistent; intake, 106 requirement IDs and gates recorded |
| Skill generator and manifest tests | 7 pass |

## Evidence carried from earlier versions (not rerun for 1.3.0)

| Check | Last passed | Note |
|---|---|---|
| Cross-app import probes fail in ESLint, `check:arch` and `boundaries` | 1.1.0 | rules unchanged since |
| Two replicas without a shared key fail the web build | 1.1.0 | `deploymentSettings()` unchanged |
| Simulated API image (`turbo prune`, `turbo run build`, `pnpm deploy --prod`) boots with only `dist` | 1.2.0 | Docker itself not run |
| `pnpm install` refused on Node 26 | 1.2.0 | `engineStrict` unchanged |

## Not verified

- Docker image builds for both apps and the CI container steps.
- Hosted CI, including the new action pins and Dependabot with pnpm 12 lockfiles.
- Identity, profiles, telemetry and recovery suites inside the workspace.

## Version history

- 1.4.0: acceptance-round fixes. Alpine base pinned by digest, root-owned code, no package managers in runtime images, BuildKit secret for the Server Action key; Corepack-installed pnpm; signed remote cache; secret scanning of the whole repo; SBOM with a digest-pinned Syft; Dependabot for both Dockerfiles; `devEngines`, `minimumReleaseAge`; one TypeScript version (`@nestjs/cli` removed); operations runbook (release order, rollback, restore, SLIs, triage, rotation); `docs/replacing-the-example.md`, verified to leave the static gate green.
- 1.3.0: root Prettier with `format:check` in CI; zero-warning lint over each whole app; `--intake` answers recorded in the manifest; CI actions v7 and `pnpm/action-setup` v6.1.0 (pnpm 12 support); catalog `typescript-eslint` 8.72.1; `@nestjs/cli` 12.0.11.
- 1.2.0: pnpm catalog; contract, e2e and migrate as Turbo tasks; API image ships `dist` only; `engineStrict`; gates and requirement IDs in the manifest.
- 1.1.0: three cross-app gates; restored `deploymentSettings()`; restored companion CI gates and Dependabot; sibling companion default.
- 1.0.2: first composite reference.
