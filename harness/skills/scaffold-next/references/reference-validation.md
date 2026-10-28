# Validation — reference 1.3.4 (2026-10-27)

These are local checks of the bundled reference. They are not evidence for a generated or adapted project. Every project needs its own runs; never copy these results into its manifest.

## Evidence for 1.3.4

Fresh generation on macOS arm64, Node 24.22.1 and npm 11.17.0.

| Check | Result |
|---|---|
| Frozen install, `format:check`, `lint` (whole project, zero warnings, plus `check:arch`), typecheck, secrets, docs | pass |
| Unit tests | 20 pass |
| Contract check and compat against scaffold-nest 1.3.3 | pass |
| Production build, bundle budget, runtime tests | pass; 2 runtime tests |
| Skill generator, manifest and verifier tests | 20 pass |
| Chromium suite against the real API and PostgreSQL, inside scaffold-turbo-nest-next 1.3.0 | 17 pass |

## Evidence carried from earlier versions (not rerun for 1.3.4)

| Check | Last passed | Note |
|---|---|---|
| OIDC protocol and browser tests (`test:identity`, `test:identity:browser`) | 1.3.0 | test issuer and isolated Redis |
| Two-instance replica flow (`test:replicas`) | 1.3.0 | render on A, mutate on B |
| Standalone real-API integration (`test:integration`) | 1.3.0 | needs a compatible API bootstrap |

## Not verified

- Docker image build and shutdown (`test:container`): no Docker daemon was available.
- A real identity provider's consent, scopes, refresh and revocation.
- Hosted CI, Safari and screen readers, field Web Vitals, deployment.

## Version history

- 1.4.0: acceptance-round fixes. Configuration validated before the port opens; JSON logs and `request.complete` lines; request timeouts; clean SIGTERM drain exits 0; Origin and Sec-Fetch-Site checks, 1 MB body limit and malformed-form rejection in `proxy.ts`; OIDC pages redirect to sign-in with a validated `returnTo`; `/healthz`; sign-in problem page; retry that refetches; field errors for every failure; unknown form fields rejected; per-page titles; `NEXT_PUBLIC_*` allowlist and action-prop checks in `check:arch`; shared code reads the feature's routes from `src/lib/feature-routes.mjs`; stale route types cleared before typecheck.
- 1.3.4: whole-project lint and Prettier; `typescript-eslint` 8.72.1; CI actions v7; contract regenerated for RFC 9457 errors; testing lessons moved from the orphaned `AGENT.md` into the docs.
- 1.3.3: `/v1` API paths; feature `index.ts` surface; `engine-strict`; version-range check; accurate identity notes.
- 1.3.2: client mutations only through hooks; cross-app import check; compatibility fix; `outputFileTracingRoot` pinned.
- 1.3.1: framework-handled SIGTERM exit 143 accepted after inspecting Next 16.4.3.
- 1.3.0: runtime profiles (OIDC, replicas, telemetry, container, load) with evidence rules.
- 1.2.1: draft-retention and input corrections; secret scanning.
- 1.1: first executable reference with generator, manifest and verifier.
