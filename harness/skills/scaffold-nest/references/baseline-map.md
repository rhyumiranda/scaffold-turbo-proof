# Nest baseline coverage

Use this map while adapting the ten phases. Paths are relative to assets/reference, so the same paths exist in generated projects. The catalog in requirements.md defines all named requirements; this map points to executable examples, not a claim that every deployment control is complete.

| Research controls | Concrete starting point | Acceptance command / review |
|---|---|---|
| F01–F02, F04, F06 | package.json/lockfile, tsconfig.json, src/platform/config.ts; generator manifest | G02; invalid-config process test; inspect recorded runtime/options |
| F03, A03 | src/projects module, src/platform module; scripts/check-architecture.mjs | check:arch + architecture negative unit tests reject feature-private imports and cycles |
| N01–N03, N05–N07, S02 | projects controller/DTO/service, auth and problem filter | test:integration: invalid inputs, owner predicates, safe outputs, integer page bounds, expected errors |
| N04, Q03 | openapi.json, contract baseline, scripts/check-contract.mjs, test/schema.mjs | contract:check + contract:compat; a breaking schema fixture must fail, not merely regenerate |
| S01, S04 | JWT verification and disposable test issuer | Signature/issuer/audience/expiry tests; actual provider/session work remains required |
| S05–S08 | request controls/config, safe diagnostics, CI audit, project operations notes | Test input/credential limits and redaction; review deployment proxy/HTTPS/shared-limiter/ASVS/update policy |
| D01–D04, D06, D08 | migrations/, scripts/migrate.mjs, database lifecycle, projects service | test:integration includes migration clean/upgrade/failed rollback, real constraints and competing writes |
| R01–R02, R07 | request/database/provider budgets, runtime lifecycle | test:runtime: failed dependency, safe timeout, real signal and bounded termination; no automatic unsafe write retry |
| O01–O02 | platform telemetry + safe error classification | Local telemetry/redaction tests; choose a protected exporter/retention policy for the actual target |
| O05–O06 | Dockerfile, .github/workflows/verify.yml | Local compiled checks and CI configuration; build/run the container on a working daemon before claiming container proof |
| A01–A08 | AGENTS.md, docs/, stable commands, manifest, independent evaluation | Follow generated docs; run concrete negative checks and inspect actual persisted output |
| Q01–Q05 | test/ unit, HTTP, migration and paired-browser harness | Use real disposable resources. API-only scope does not require generating a frontend |

## Deliberate remaining boundaries

- S08 starts at generated docs/security-verification.md: versioned ASVS requirement/evidence selection, pinned secret scanner with a masked negative fixture, scheduled checks and weekly dependency-update configuration. Run check:secrets and check:docs; hosted execution, response ownership and full threat-model coverage still need actual project evidence.

- A real identity provider is a project input. Its login/token issuance, rotation/revocation and logout cannot be certified by the test issuer.
- D05/D07, Q06/Q07, O03/O07/O08 and replicated S06/O02 controls need the selected deployment, compatibility policy, traffic, owners and timed recovery evidence. Ship the concrete runbook, then record actual results; do not fill in fictional owners or measurements.
- N08, S03, R03–R06/R08, O04 and L01–L10 are selected profiles. They are not prebuilt extensions. Implement their referenced acceptance cases before claiming support.
- The baseline example has one atomic rename, not a universal transaction/idempotency design. New multi-record operations must add their actual transaction and rollback tests.
- G08 requires a fresh-agent exercise; source lint and helper tests cannot establish skill behavior.
