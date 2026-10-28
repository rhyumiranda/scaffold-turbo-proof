# API-backed Next architecture

The supplied API owns identity verification, resource permissions and persistence. This application owns presentation, session adaptation and API transport. The example domain can be replaced; ownership/deletion rules must come from the chosen product contract.

| Responsibility | Concrete source | Allowed next step |
|---|---|---|
| Server-rendered list/detail | `src/app/projects/` | `services/projects.server.ts` |
| Interactive form | `components/project-form.tsx` | `hooks/use-project-form.ts` |
| Form state/focus and action choice | `hooks/use-project-form.ts` | `actions/projects.ts` |
| Validated mutation | `actions/projects.ts` | server service |
| Typed transport | `services/projects.server.ts` | external API |

All feature paths above live under `src/features/projects/` except routes. Shared platform code (sign-in landing page, session-guarded pages, telemetry operation names) reads the feature's routes only from `src/lib/feature-routes.mjs`; change that file when the feature changes. Types may cross layers through `import type`. Client components never import, receive or bind a Server Action, and never fetch; their hook imports the action and returns `submit`. Server Components with no client state may pass an action to a plain `<form action>`. Services never import hooks/components/actions. Another feature must import a feature's public `index.ts`, not its internals. Routes import a feature only through its `index.ts`, like other features do. `check:arch` rejects a route importing a feature's private files.

`npm run check:arch` parses TypeScript imports, reexports and literal dynamic imports, rejects cycles, raw UI/hook transport, client components importing actions or services directly or through a shared component, private cross-feature imports and transitive server-runtime leaks into clients. `scripts/architecture.test.mjs` contains allowed RSC/action fixtures and rejected examples. This syntactic gate complements compilation/review; it is not a security sandbox against deliberately obfuscated JavaScript.

## Cache and navigation policy

Projects are private and fetched per request with `cache: no-store`; bearer tokens never enter module state or browser props. No shared server or client query cache is added. Create refreshes `/projects`; rename refreshes list and detail. Pagination is `/projects?page=N`, 25 records, pages 1–401 matching the example API offset bound. Links preserve normal refresh/history behavior. There are never more than 25 rendered rows, so this profile does not need virtualization. Changes to sorting/filtering require matching API semantics and URL tests.

## Security and runtime

`src/proxy.ts` replaces incoming request IDs, generates a fresh CSP nonce and sets the request/response CSP. `src/app/layout.tsx` opts into dynamic rendering, required for nonce-bearing framework scripts. No production `unsafe-inline` or `unsafe-eval` is allowed. HTTPS adds HSTS; the deployment proxy must preserve the correct external scheme. CSP is a defense layer, not authentication. Authenticated server calls still reach the API for independent verification.

`src/instrumentation.ts` enables portable OpenTelemetry export only when an approved collector endpoint is configured. The transport produces allowlisted JSON operation/status/duration logs, forwards correlation and W3C trace context, and never logs bearer tokens, response bodies, record names, raw errors or query URLs.

Sources checked for the pinned Next 16.4.3: [CSP](https://nextjs.org/docs/app/guides/content-security-policy), [instrumentation](https://nextjs.org/docs/app/guides/instrumentation), [Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
