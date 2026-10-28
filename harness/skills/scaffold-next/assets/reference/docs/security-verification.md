# Security verification plan

This is a test/evidence plan, not an ASVS certification. Scope: private Projects create/list/read/rename. Before release assign a security owner, select the actual identity provider, classify product data, review the full [ASVS 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0/5.0/en) against the real threat model, and add omitted applicable requirements. Never infer a complete level from this starter selection.

| ASVS 5.0 requirement | Local evidence to run | Remaining verification |
|---|---|---|
| 2.1.1, 2.2.1, 2.2.2 — documented, trusted input validation | OpenAPI + DTO/action validation; unit and integration tests reject blank, oversized, unknown and unsupported text | Recheck every new operation at the API; client validation is only feedback |
| 8.1.1, 8.2.2, 8.3.1 — documented object authorization at trusted boundary | Owner predicates, cross-user HTTP/browser cases, stale-version tests | Actual provider claims/roles and changed permissions |
| 14.2.1, 14.2.2 — credential transport and private cache handling | Bearer headers, server-only transport, no-store reads, redacted diagnostics | TLS/proxy/CDN configuration and cache isolation at the target |
| 14.3.1, 14.3.3 — client session cleanup and no sensitive persistent browser storage | Browser session-switch test; drafts stay in document memory only | Real logout/expiry/account switching must clear DOM/router state via a full-document transition; verify Back after logout |
| 14.1.1, 14.1.2 — classification/protection policy | No production data in tests; structured log allowlist tests | Name data classes, owners, retention, encryption and telemetry permissions before release |

## Required checks and update policy

- Every PR: frozen install, build, types, architecture, unit, real integration, contracts, `npm run check:secrets`, `npm audit --audit-level=high`. Secretlint's pinned recommended rules scan working-tree source/config, including dotfiles; build outputs and dependencies are excluded. It does not inspect Git history or prove absence of all secrets. Enable host-side push protection/history scanning on the actual repository.
- Weekly: Dependabot npm/action PRs and the scheduled verification workflow. A failed scheduled run needs an assigned owner; schedule configuration alone does not establish hosted execution or alert delivery.
- On a framework/provider security advisory: owner triages within one working day, records affected versions/exposure and an explicit remediation deadline. Critical exploitable exposure blocks release; do not auto-merge upgrades or dismiss findings merely because tests pass.
- Upgrade exact versions with reviewed lockfile changes. Rerun all affected gates, install-policy negative fixture, browser failures and runtime checks. Never re-enable dependency install scripts globally to work around an upgrade.
- Before promotion: resolve provider/session tests, configure branch-required checks, choose deployment/secret access, verify container smoke, restore, load and alerts. These remain blocked until real evidence exists.

If a secret is detected, do not paste it into logs or tickets. Revoke/rotate through the authorized owner, then remove it and address historical exposure. Masked scanner output is not permission to retain leaked credentials.
