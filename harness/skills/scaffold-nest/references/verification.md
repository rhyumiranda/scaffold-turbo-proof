# Verification and completion

Run against the generated project, not a remembered reference. Use the Node and npm versions pinned in the project's `.nvmrc` and `package.json`. The reference's previous results are not evidence for an adaptation.

## Executable gates

```bash
node <skill-directory>/scripts/verify.mjs --project /absolute/project --gate G02
node <skill-directory>/scripts/verify.mjs --project /absolute/project --gate G03
node <skill-directory>/scripts/verify.mjs --project /absolute/project --gate G07
node <skill-directory>/scripts/check-manifest.mjs /absolute/project/scaffold-manifest.json
```

- G02 executes frozen installation, lint, architecture checks, types, production build, unit/negative tests, contract validation, compatibility and secret scanning. Scanner failure blocks this gate; its synthetic negative fixture must also pass.
- G03 executes test:integration. Nest requires a disposable real PostgreSQL database; Next requires the committed isolated-API bootstrap described in its generated docs/testing.md. An unconfigured bootstrap fails, never skips.
- G07 executes test:runtime against compiled output. Set its documented isolated configuration first.
- The runner stops at the first failed command, records exit codes/time/output digests in .scaffold/evidence/, and updates only that gate. It never promotes the project to locally_verified.
- Every command has a three-minute budget with bounded termination. For a legitimately slower target, review/change that budget and record why; do not turn a timeout into a pass.
- Keep secrets in the process environment. Evidence contains commands and results, not credential values.
- Run npm audit --audit-level=high separately; an audit is not application-security certification.
- Run check:docs and check:budget when provided by the generated project. Read the exact package scripts and architecture guide before adapting them.

## Gates requiring evidence review

| Gate | Required evidence |
|---|---|
| G01 Safe generation | New path, spaces, dry-run no writes, invalid inputs, symlink handling, overwrite refusal, interrupted-directory preservation and recovery into a new destination |
| G02 Reproducible build | The full executable sequence above passes from the actual generated files |
| G03 Working application | Compiled HTTP API + real database for Nest; compiled browser app + actual supplied API and persisted state for Next |
| G04 Security boundary | Actual auth policy, missing/forged/expired credentials, direct calls, cross-user access, minimized outputs, secret handling |
| G05 State correctness | Real persistence/reload, conflict/concurrency, failed mutations retaining input, repeated requests, cache/navigation behavior |
| G06 Optional profiles | Every selected profile has its own failure/invariant evidence; N/A only when selectedProfiles is empty |
| G07 Runtime | Config rejection, dependency failure/deadline, health transitions, process signals/bounded exit, safe diagnostics |
| G08 Skill/adaptation | A realistic independent skill invocation produces runnable output; a renamed domain retains equivalent invariants and tests. Helper tests alone do not prove this |
| G09 Deployment | Authorized real-target smoke, security/config/cache, load, recovery and ownership evidence; otherwise not_run/blocked |

G03 evidence may support G04/G05, but inspect the individual assertions before marking those gates. A test count is not a control mapping. Optional tests cannot stand in for an unimplemented provider or deployment.

For a deliberately provider-deferred exercise, passing synthetic JWT/cookie tests is valid local behavior evidence, not a complete G04 pass. Keep G04 blocked with that evidence and the missing actual-provider/session checks named. Keep overall status generated; report “local API/browser checks passed; real authentication integration remains blocked.” This is an intentional boundary, not a reason to invent a login provider or weaken completion rules.

## Manifest rules

Schema v2 records versions, generator command, file inventory/checksums, selectedProfiles, per-profile evidence, authIntegration/authEvidence, integration classification and G01–G09.

selectedProfiles covers both product capabilities (tenancy, idempotency, jobs, webhooks, uploads, realtime, optimistic, ai) and selected runtime checks (oidc, replicas, redis-limiter, telemetry, recovery, container, load, accessibility). Record only applicable profiles actually selected for this project; shipping a helper does not automatically select it. Put exact observed evidence paths in profileEvidence under each selected name. G06 cannot pass unless every selected profile has evidence; if any selected check is blocked, keep G06 blocked with a reason and retain other successful evidence. N/A is valid only for an empty selection. A local OIDC pass never resolves real-provider G04; local container/load/recovery evidence never resolves real-target G09.

Example: selectedProfiles: ["oidc", "replicas", "container"], profileEvidence: {"oidc": ["evidence/login.log"], "replicas": ["evidence/replicas.log"]}. G06 stays blocked with reason "Docker daemon unavailable" until the container check runs successfully and its actual evidence is recorded. Do not add a dummy result to make validation pass.

- Keep authIntegration as provider-configuration-required until the selected provider's actual session/token workflow is verified. Synthetic test JWTs do not prove it.
- provider-integrated requires evidence. public-only requires the deliberately chosen public-data/write policy and negative tests; never switch to it to avoid missing credentials.
- For local completion, Nest requires real-api-database and Next requires real-api integration. fixture-only is useful UI evidence, never integration proof.
- Passed gates need evidence. Failed/blocked/N/A gates need reasons. Selected profiles cannot be waived.
- A valid report is only internally consistent. It does not establish that evidence is truthful or complete.
- Retain v1 reports as historical evidence. Rebuild the v2 applicability fields from the current project; do not mechanically copy old pass labels.

Completion: generated means files exist; locally_verified requires G01–G08 plus resolved real integration/auth; deployment_verified additionally requires actual G09 evidence. Give exact blockers and runnable next commands, not a blanket production-ready label.
