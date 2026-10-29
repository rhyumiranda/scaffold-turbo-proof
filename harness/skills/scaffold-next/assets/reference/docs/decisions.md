# Architecture decisions

## TypeScript stays on 5.9.3

TypeScript 7.0 is out, but typescript-eslint 8.72 declares `typescript >=4.8.4 <6.1.0`, so linting would be unsupported on 7. Revisit when typescript-eslint supports TypeScript 7, then rerun every gate.

## Reference 1.2.1 — Draft and input corrections

The independent audit additionally exercised oversized expectedVersion values and malformed request encodings. Expected versions now fit PostgreSQL's signed integer range; the trusted body-parser boundary translates its 400/413/415 errors before the global problem filter. Arbitrary application exceptions still become redacted 500s. Valid compressed JSON remains supported. The initial accepted schema includes the range and 415 response; generated clients are refreshed. This is a reviewed unpublished-example correction, not a waiver of compatibility for deployed consumers.

React action forms reset uncontrolled inputs after completion. A controlled value plus edit revision prevents a completed save from erasing subsequent typing. Keep dirty drafts and their original expected version in document memory for history restoration instead of manipulating Next's private history state or saving private text to browser storage. Successful rename advances the expected version for a subsequent save. Full-document departure requires a native warning; accepted departure loses memory by design. Provider session transitions must clear the document/router, not merely replace a cookie.

Reject NUL before PostgreSQL text input; it formerly passed validation and returned 500. The source and initial accepted OpenAPI now document the restriction. Valid Unicode remains supported. This intentionally tightens validation in the unpublished example; a released API needs its own compatibility decision, not an automatic accepted-schema rewrite.

## 001 — Separate API authority

Use a supplied HTTP API instead of adding an ORM to Next. This keeps business permissions/persistence in one place and allows a non-Nest API. The tradeoff is an additional network boundary; services enforce a four-second deadline and safe failure states. Revisit only if the product explicitly chooses a Next-owned backend.

## 002 — Request-local private data

Use server-first rendering and no-store project reads rather than a shared cache. Simplicity and user isolation matter more than avoiding small reads in this starter. Revisit with measured load and a tested user/tenant cache key/invalidation design; do not add cache infrastructure speculatively.

## 003 — Strict nonce CSP

Choose dynamic rendering with fresh per-request nonces. This disables static rendering of these private screens and adds request-time work, but permits strict script policy with the App Router. Static/public routes added later need an explicitly tested separate CSP strategy. Revisit for measured public-page performance, not to silence violations.

## 004 — Real integration fails closed

CI always attempts an isolated real API browser journey. Until `tests/integration-bootstrap.mjs` knows the selected API/test identity setup, the job fails with an actionable blocked message. A green fixture test cannot establish authentication or database persistence. Protected branches must require both `static` and `real-integration` checks once this workflow is installed.

## 005 — Performance budget scope

`performance-budget.json` initially limits all individually gzipped client chunks to 400,000 bytes. This is a conservative whole-application asset regression guard, not a route-transfer budget or field-performance result. The webpack client build also uses a 100,000-byte maximum split size so the shared Next runtime can yield between evaluation tasks on throttled mobile hardware; the total-byte check still catches duplication. Record the measured bundle, routes, target devices/network and reason here before changing either limit. Obtain actual user latency/Core Web Vitals after deployment.

## 006 — Initial accepted API contract

Before initial publication, synchronized the paired reference's explicit problem responses, integer pagination/version fields and `413 PAYLOAD_TOO_LARGE` response into the source and initial accepted schema. The oversized JSON response was corrected from an accidental 500 and verified by the API's real HTTP tests; success DTOs did not change. This is initial reference establishment, not permission to silently replace an accepted contract after consumers exist.

## 007 — Streamed not-found pages keep HTTP 200

`/projects` and `/projects/[id]` stream behind `loading.tsx`, so the skeleton appears at once on slow API calls. Next.js sends the status line before the page decides an id is missing, foreign or malformed. Those pages therefore render the not-found view with HTTP 200 and a `noindex` robots tag (a "soft 404"). The API still answers 404, and these private pages are never indexed. Unknown URLs outside a streamed segment return a real 404. Remove the `loading.tsx` for a segment only if a client needs the HTTP status more than the instant loading state. Streaming also means these pages need JavaScript: without it the loading state is never replaced, so the forms are not offered as script-free fallbacks, and the proxy rejects script-free Server Action posts that carry unexpected arguments.

## 008 — Session preflight preserves mutation drafts

JavaScript project forms check `/auth/refresh` before dispatching a business mutation. A 401 keeps the controlled draft in the current tab and offers sign-in in a new tab; the user explicitly submits again after sign-in, so the app never retries a business write automatically. The Server Action still redirects an expired request to same-origin sign-in without writing. This is the authority for races, replay and clients without JavaScript; the preflight is only a user-experience guard.
