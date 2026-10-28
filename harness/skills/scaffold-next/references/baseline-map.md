# Next baseline coverage

Use this map while adapting the ten phases. Paths are relative to assets/reference. requirements.md retains the named research controls; this map distinguishes executable examples from actual API/provider/target evidence.

| Research controls | Concrete starting point | Acceptance command / review |
|---|---|---|
| F01–F02, F04, F06 | package.json/lockfile, tsconfig.json, scripts/start.mjs, generator manifest | G02; test:runtime rejects missing/invalid server configuration |
| F03/F05, W01–W02, A03 | feature responsibilities, scripts/check-architecture.mjs | check:arch + negative fixtures: direct client fetch, private-feature imports, server leakage and cycles fail; valid server reads pass |
| N04/N05, Q03 | contract/openapi.json, generated types, contract checks | contract:check + contract:compat; runtime schemas protect actual external responses |
| S01–S04 | services/projects.server.ts and server actions; isolated test identities | Real API checks plus actual provider login/refresh/logout/cookie verification; no browser token entry workaround |
| S05–S08 | nonce CSP, server config, safe telemetry, CI gates | Production browser tests; negative header/config/log tests; deployment origin/proxy/security-plan review |
| R01–R02 | server service deadlines and safe errors | Timeout/failure recovery evidence; no automatic replay of ambiguous mutations |
| W03–W04, Q05 | no-store server reads, server actions, native form state | Real browser conflict/input retention, persisted reload and invalidation tests |
| W05–W07 | route states, URL pagination, form/hook and CSS | Real browser empty/error/recovery/navigation/focus/mobile/laptop/ultrawide checks |
| W08 | metadata, scripts/check-budget.mjs, production output | check:budget and production browser evidence; record traffic/device budgets separately from field Web Vitals |
| O01–O02 | src/lib/telemetry.ts and instrumentation | Safe logs/correlation tests; trace exporter/access/retention need actual target configuration |
| O05–O06 | standalone start, Dockerfile, required integration workflow | Build and run artifact; unconfigured isolated API bootstrap fails rather than silently skipping browser checks |
| A01–A08 | AGENTS.md, docs/, stable commands, manifest, fresh-agent evaluation | Follow the generated project records and inspect actual browser/persisted outcomes |

## Integration is a real boundary

tests/integration-bootstrap.mjs is a committed interface for starting the project's isolated API and short-lived identities. The default is intentionally unresolved. Configure it during scaffolding using docs/testing.md. The paired-Nest example is an optional test adapter, not a runtime or skill dependency.

An existing API can use another implementation of that interface. Do not generate a substitute backend, inject fixed personal tokens, or count fixture responses as upstream persistence/security evidence. PR integration checks remain blocked until the real test context exists.

## Deliberate remaining boundaries

- S08 starts at generated docs/security-verification.md: versioned ASVS requirement/evidence selection, pinned secret scanner with a masked negative fixture, scheduled checks and weekly dependency-update configuration. Run check:secrets and check:docs; hosted execution, response ownership and full threat-model coverage still need actual project evidence.

- Actual provider login/callback/refresh/logout and secure cookie issuance are selected-project work. A test browser setting a signed cookie is not login proof.
- S03, optional client queries/optimistic state, uploads/realtime and L01–L10 need the product's API/profile and dedicated failure tests. No implicit ORM, jobs or AI SDK.
- Q06/Q07, O03/O07/O08, replicated caches/action keys, field performance, full assistive-tech assessment and deployment security need their actual environment. Include concrete runbooks without claiming those checks passed.
- G08 needs a realistic fresh-agent adaptation. Deterministic copying alone does not prove the skill can adapt a domain.
