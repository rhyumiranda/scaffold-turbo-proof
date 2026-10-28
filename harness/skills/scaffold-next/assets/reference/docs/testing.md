# Reproducible checks

Use Node 24.22.1 and npm 11.17.0. From this project:

```sh
npm ci
npm run contract:check
npm run contract:compat
npm run lint
npm run test:unit
npm run check:docs
npm run typecheck
npm run build
npm run check:budget
npm run test:runtime
npx playwright install chromium
npm run test:integration
```

Run `npm run contract` only after an intentional API schema change, then review the diff. Never run it before `contract:check`: regeneration would hide the drift the check exists to catch.

Unit checks exercise the architecture guard using prohibited fixtures, logging redaction, byte-budget failures and missing integration setup. Runtime checks boot the actual standalone build without private data, inspect changing CSP nonces and exercise SIGTERM. They do not replace API integration.

The CSP browser check fault-injects an unnonced parser script into the real server HTML response, preserving its CSP and real API data. It requires an actual browser policy violation, denied script execution and a working form. Runtime `createElement('script')` inside trusted/evaluated JavaScript is not an untrusted-HTML probe under `strict-dynamic`; that policy intentionally permits trusted dynamic loaders.

`contract:check` generates types into an owned temporary directory and compares them without editing tracked files. `contract:compat` expands local schema references and rejects changes to any accepted existing operation, including response/security changes; additive operations pass. This intentionally conservative guard may require review for compatible changes too. Never overwrite `contract/accepted.openapi.json` merely to turn CI green: record consumer/version compatibility evidence in decisions first, then accept an intentional reviewed baseline update. External/cyclic schemas need a deliberately selected compatible schema tool; they fail closed here.

## API-independent integration bootstrap contract

Implement the committed `tests/integration-bootstrap.mjs` export `async run({webDirectory})`. It must:

1. Start an isolated compatible API and disposable test dependencies; apply reviewed migrations. Never use shared/production data.
2. Provision short-lived test identities through a test issuer/provider, without adding a production auth bypass.
3. Start this compiled frontend with `API_BASE_URL`, then execute its pinned Playwright CLI with process-only `TEST_API_URL`, `TEST_ALICE_TOKEN`, `TEST_BOB_TOKEN`, `WEB_TEST_URL`.
4. Await browser completion; close all owned processes in `finally`; return 0 only on success. Reject on missing infrastructure and enforce a finite timeout.

The real HTTP API must implement `contract/openapi.json`. The backend technology is irrelevant. A fixture server is not an implementation of this bootstrap contract. Avoid logging environment values or writing test tokens into reports.

## Executable paired-Nest adapter

`tests/adapters/nest.mjs` is a complete optional adapter around the paired reference's real API/PostgreSQL/JWT/browser harness. It requires a separately generated, installed and compiled compatible Nest reference. No backend is generated or installed by this frontend.

```sh
NEST_TEST_PROJECT=/absolute/compiled-api DATABASE_URL=postgresql://test_user@127.0.0.1:55437/acme_test npm run test:integration
```

This sample only accepts loopback or an isolated CI `postgres` service. Before running, confirm the database is disposable. The adapter performs application writes through the actual API and schema changes through the API's migration runner.

For another API, replace the bootstrap with its repository-owned test harness; preserve the interface and cleanup/timeout guarantees. In CI, provision that API/dependencies in `real-integration` before the command. No production secrets belong in a PR job. Missing setup intentionally makes CI red, not skipped. Configure required branch checks in the hosting service; the YAML alone cannot enforce branch policy.

The reference does not select a production login provider. Completing the bootstrap is test setup, not production login/session completion. Test actual callback/expiry/logout/refresh once the provider is chosen.
