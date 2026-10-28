# Frontend architecture and transport

Read for phases 2–4. This skill's API-backed profile is a recommendation, not a statement that all Next applications require separate backends.

## Responsibilities

| Layer | Owns | Excludes |
|---|---|---|
| Components | Rendering, accessibility, local interaction | Privileged credentials, authoritative business policy, Server Action or service imports in client files |
| Hooks | Client/query state, mutation coordination, and the only client import of Server Actions | Server-only imports, duplicate backend decisions |
| Actions | Server mutation entrypoints, input/session checks, refresh | Ordinary GET transport, direct application DB operations |
| Services | Typed API transport, deadlines, safe failures | React state, redirects, caller credentials in global state |

Organize used responsibilities by feature:
```text
src/app/                         routes, layouts, thin GET handlers
src/features/<feature>/
  components/
  hooks/
  actions/
  services/                      explicit server/browser entrypoints
src/components/ui/               project design primitives
src/lib/                         small shared framework infrastructure
src/generated/                   browser-safe contract client, if colocated
tests/e2e/
```
Do not generate empty layers for the appearance of architecture. Keep clear feature exports and automated import restrictions. Avoid universal shared packages that leak server code.

## Read and mutation paths

- Initial server read: Server Component → server-only service → external API.
- Interactive client read: component → query hook → browser service → narrow GET Route Handler → server service → API.
- Client mutation: client component/form → hook → Server Action → server service → API. The hook is mandatory; a client component never imports, receives as a prop, or binds a Server Action.
- Server form: Server Component `<form action>` with no client state → Server Action → server service → API.

A server read should not call its own GET handler over HTTP. Actions are not the default read API. Server Components do not need hooks. Direct browser-to-API is an alternative only when chosen with explicit authentication/CORS/CSRF design; do not generate competing transports for the same resource.

Use small client boundaries around actual interaction; do not mark the entire application client-side for convenience. Mutations must not run during render. Filter data sent as props/action results to browser-safe fields. A URL/path/query is input, not authority.

## API independence

Accept the provided OpenAPI or equivalent agreed contract without requiring NestJS. Generate compatible browser-safe types/client code and test drift. Run contract:check and contract:compat; a regenerated type file can still encode an incorrect or incompatible API. Validate responses at untrusted external boundaries where malformed data could break assumptions. Static types are not runtime validation.

For a new resource in a brand-new project, replace the example schema with the actual agreed API and establish its initial accepted baseline. For an existing API, retain the previous accepted schema until the breaking-change/versioning decision is explicitly resolved. Do not edit generated types by hand or weaken compatibility fixtures.

Services receive caller credentials per request; do not put credentials in module globals or cross-request caches. Set deadlines and safe errors; let actions/routes decide redirects and UI outcomes. Retry policies must not replay ambiguous mutations blindly.

If the API is unavailable, a contract-backed fixture may unblock UI work. Keep it test/development-only, make it fail closed outside those modes, and mark integration unverified. Do not invent auth, endpoints, persistence, or a backend just to make browser tests green. A mocked response cannot prove real ownership or persistence.

## Configuration and build

Select compatible exact Node/Next/React/package-manager/generator versions. Pin the initializer if used and disable auto-commits. Inspect generated configuration and retain the user's supported package manager. Provide non-mutating lint, explicit type checking, contract generation/check, unit/browser tests, production build, and production start.

Split server and public environment schemas. Secrets must not use public exposure conventions or appear in bundles, serialized props, errors, logs, or source maps. Explain public build-time variables versus runtime settings. Validate meaningful required configuration without embedding secrets in a build.

Enforce server/browser boundaries in builds/lint and include a negative import test. The server-only marker can catch accidental client imports, but it does not replace authorization or output filtering. [Next data security](https://nextjs.org/docs/app/guides/data-security)

Keep a short repository navigation map, feature guide, commands, decisions, and runnable examples. Existing design systems and product rules take precedence over generic visual defaults.
