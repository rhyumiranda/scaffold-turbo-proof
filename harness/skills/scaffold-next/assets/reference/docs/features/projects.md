# Projects example flow

Actors: an API-authenticated owner and another authenticated user. The example API—not this UI—decides ownership. Supported operations: list, read, create, rename. No delete operation is implied.

Read: `/projects?page=N` → `listProjects(N)` → authenticated `GET /v1/projects?limit=25&offset=…` → validated safe DTOs → rendered list and pagination. Invalid page input produces not-found. An empty page still offers previous-page navigation.

Create: form → `useProjectForm` → session preflight → `createAction` → trim/validate name → `createProject` → real API → refresh list and expose the new resource link. Clear only the submitted draft on success; later edits remain. Blank/unsupported names focus the field; pending disables submit but permits further typing. The server remains responsible for duplicate semantics.

Rename: detail form includes an expected version → action validates id/name/version → API atomic version check → refresh list/detail. A stale version produces a conflict message and preserves the submitted name. Retry after reviewing current persisted state; do not silently overwrite.

Failure: missing/expired/forged credentials expose no rows. Provider session setup is unresolved, so the reference gives a truthful sign-in explanation, not a fake working login. API failures expose a recovery screen or safe inline message. Internal logs retain only operation/status/duration/correlation.

Expiry recovery: a JavaScript submit first posts to `/auth/refresh`. A 401 keeps the controlled draft in the current tab, announces that the session expired and offers a new-tab sign-in link. After signing in, submitting again performs the mutation. Direct Server Action requests still redirect to same-origin sign-in without writing, covering races and clients without JavaScript.

Tests: `tests/projects.spec.ts` covers real create/rename/reload, cross-user denial, forged credentials, conflict/input retention, pagination/history, CSP and selected keyboard/layout checks. It is not a full accessibility certification or provider-login test.

Drafts: `tests/form-regressions.spec.ts` checks delayed successful/failed saves, Back/Forward restoration, cancel/discard navigation, reload/external leave warnings, session changes, NUL correction and real mobile hit areas. Draft values and their original version stay in tab memory through history navigation, so returning to a stale draft still produces a version conflict. They are not persisted in browser storage. Accepted link departure discards; accepted document unload closes the in-memory store. A new session scope clears previous drafts. Provider logout/account changes must use a full-document transition to clear private DOM/router caches, then prove Back cannot reveal private state.

When adapting: replace schema/service/actions/UI/tests together; retain equivalent negative authority, stale-write and persisted-state checks. Do not merely rename project strings if the actual domain has different permissions or transitions.

## Duplicate submissions and retries

`POST /v1/projects` is not idempotent: each accepted request creates a new project. The web form disables its submit button while a request is in flight, so a double-click or a second Enter creates one project. Neither the web app nor the API retries a write automatically. After a timeout or a 5xx on create or rename, the write may already have been saved: the form says so and keeps the input; reload the list before submitting again. Rename is safe to retry with the same `expectedVersion`: a second attempt after a saved first one gets 409.
