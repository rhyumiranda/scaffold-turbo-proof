# Executable Next reference — read before scaffolding

Start from [assets/reference](../assets/reference), not a fresh interpretation of the prose. Use the safe [generator](../scripts/scaffold.mjs). It copies a locked, executable frontend and refuses existing destinations. It installs nothing, commits nothing, and deploys nothing.

## Exact starting commands

```bash
node <skill-directory>/scripts/scaffold.mjs --destination /absolute/new-web --name my-web --dry-run
node <skill-directory>/scripts/scaffold.mjs --destination /absolute/new-web --name my-web
cd /absolute/new-web
# Select Node 24.22.1 with the user's runtime manager first.
npm ci
npm run contract:check
npm run contract:compat
npm run lint
npm run check:secrets
npm run test:unit
npm run check:docs
npm run typecheck
npm run build
npm run check:budget
npm run test:runtime
```

Set API_BASE_URL to a compatible API origin. With it available, npm start runs the actual standalone production output, including its static assets. No API is silently generated.

## Phase-to-file map

| Phase | Copy/read these exact files | Required behavior |
|---|---|---|
| 1 Contract | contract/openapi.json, .env.example | Actual API contract or explicit selected example |
| 2 Foundation | package.json, tsconfig.json, scripts/check-architecture.mjs, AGENTS.md, docs/ | Locked types/build; negative-tested architecture boundaries; project-local records |
| 3 Layers | app/projects routes; features/projects/{components,hooks,actions,services} | Exact connected four-layer example |
| 4 Boundary | services/projects.server.ts; actions/projects.ts; src/proxy.ts | Server-only token transport, input validation, safe errors and nonce CSP |
| 5 Cache | projects.server.ts; actions revalidatePath; projects/page.tsx | Private no-store reads; list/detail refresh; bounded URL pagination |
| 6 Journey | components/project-form.tsx; hooks/use-project-form.ts | Create and rename with real form state and server actions |
| 7 States | loading.tsx, error.tsx, not-found.tsx, globals.css | Recovery, focus, keyboard, responsive long content |
| 8 Performance | server routes; layout metadata; scripts/check-budget.mjs | Small client boundaries; private metadata; checked compiled-byte budget |
| 9 Runtime | scripts/start.mjs, src/instrumentation.ts, src/lib/telemetry.ts, Dockerfile, workflow | Standalone runtime, safe cross-service diagnostics, required integration gate |
| 10 Evidence | tests/projects.spec.ts | Browser persistence, ownership, conflict/input retention, keyboard/layout |

## Exact layer example

Read:
```text
app/projects/page.tsx
  → services/projects.server.ts:listProjects()
  → GET /v1/projects?limit=25 with a per-request bearer token
```

Write:
```text
components/project-form.tsx
  → hooks/use-project-form.ts (useActionState, pending/focus)
  → actions/projects.ts:renameAction()
  → services/projects.server.ts:renameProject()
  → PATCH /v1/projects/:id {name, expectedVersion}
  → revalidatePath(list and detail)
```

Server Components do not use client hooks. Actions are for mutations, not initial GETs. No browser HTTP service is needed for this server-read example; add that path only for an actual interactive client-read requirement.

## Input and failure behavior

Use the real form and action files as the example, including server-returned inputValue. Do not rewrite them into a toy onClick fetch or remove the negative cases.

| Situation | Required UI behavior |
|---|---|
| Blank name | Inline error; focus Project name; no API mutation |
| Valid create | Pending feedback; Project created.; list refresh |
| Valid rename | New persisted name; detail/list refresh; survives reload |
| Another actor changed version | 409 becomes “This project changed…”; keep unsaved name |
| Expired session | Explain sign-in requirement; do not expose private rows |
| API unavailable | Recovery state or safe form error; retain useful input |
| User reloads/navigates with unsaved edits | Applicable leave warning |
| Mobile/keyboard | No horizontal overflow; usable targets and visible focus |

In browser tests wait for the destination heading/form before filling a reused label after SPA navigation. Do not use arbitrary sleeps. A link click can finish while the outgoing create form is still visible; asserting persisted data must stay in the test.

Bound a canceled `page.reload()` or `page.goto()` promise and assert the kept value after dismissing `beforeunload`. A canceled navigation can leave its promise waiting until the whole test times out.

## Authentication seam — explicit, not fake

With AUTH_MODE=external-cookie (default), the reference reads api_session as an HttpOnly cookie containing an API-issued bearer token. It forwards it only from a server-only service. Missing/invalid credentials fail closed; no demo login route or production bypass exists. AUTH_MODE=oidc selects the shipped library-backed server-session flow; read [runtime profiles](production-profiles.md) before configuring it.

Before claiming the actual application complete, integrate the selected provider's login/callback/logout/refresh flow and cookie issuance. Use secure production cookies and the appropriate same-site/CSRF design. Tests set short-lived signed test tokens using the browser test context; that is not production session creation. Do not tell users to paste production tokens into browser JavaScript.

## Browser checks

Against any real compatible API, supply short-lived TEST_ALICE_TOKEN, TEST_BOB_TOKEN, TEST_API_URL and WEB_TEST_URL through a protected process environment. Start the compiled frontend, install the pinned Playwright browser, then run npm test. No token values belong in logs or fixtures.

If the Nest reference is also being tested, its test/with-web.mjs harness starts a real API, local test JWT issuer, and compiled frontend against a dedicated PostgreSQL database:
```bash
# From the compiled Nest reference; DATABASE_URL must target a disposable DB.
NODE_ENV=test node test/with-web.mjs /absolute/compiled-web-project
```
The Next skill does not require this harness or Nest; its tests accept any compatible real API.

## Known boundaries — finish during the phases

- A selectable OIDC login/refresh/logout implementation is shipped; the chosen real provider's configuration, audience/scopes, consent and revocation behavior still require verification.
- URL pagination, strict nonce CSP, safe logging/correlation and local budget/runtime tests are supplied. Actual design-system choices, full assistive-tech checks, field performance, cache replication, external alerts and deployment need their own evidence.
- CI runs the real-integration job on PRs and pushes. Configure tests/integration-bootstrap.mjs using docs/testing.md; unresolved setup fails instead of silently skipping browser checks. The paired Nest adapter is an executable option, not a required backend.
- Use isolated dependencies and short-lived synthetic identities in PR checks, never production credentials. Hosted branch-protection settings require actual repository configuration and are not established by YAML.
- No ORM, Nest dependency, branding, model SDK, tenancy, or background worker is added implicitly.

## Extending the example

Run test:unit and check:arch after each boundary change. Negative fixtures must reject client transport, private-feature imports, cycles and server leaks; a valid Server Component read must remain permitted. Run contract:check and contract:compat whenever the API changes. Keep generated types generated.

Adapt the actual resource, access policy, response schemas, URL behavior and persisted browser assertions together. A new/unreleased API establishes its own accepted schema; an existing API requires a reviewed compatibility decision.

The generated AGENTS.md and docs explain setup, flow, decisions, integration bootstrap and recovery without relying on access to the installed skill. Use the skill's verify.mjs to record observed checks; it cannot resolve the provider or deployment for you.
