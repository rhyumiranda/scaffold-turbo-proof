# Sessions, cache isolation, and state correctness

Read for phases 4–6. Apply S01–S08, W03–W06, and relevant R requirements.

## Server entrypoints

Integrate the actual identity provider and session contract. Do not invent local production login or assume API bearer tokens are browser-safe. Keep protected credentials on the server where the selected profile requires it.

Treat exported Server Actions and Route Handlers as independently reachable. Validate inputs and authenticate/authorize protected calls, or delegate through a server-only operation that does so. A layout redirect, hidden control, or route proxy is insufficient. Upstream APIs must independently verify identity/resource access. Return only UI-safe data. [Next data security](https://nextjs.org/docs/app/guides/data-security)

Use secure HttpOnly cookies where appropriate, explicit expiry/logout, and provider-supported rotation/revocation. Test stale/forged sessions. Define a safe return-to URL policy. Configure origin/CSRF behavior for the actual proxy/cookie topology; do not assume CORS proves authorization. Use narrow external origins and target-appropriate security headers/CSP without breaking required rendering. Apply request-size, rate, duration, and concurrency limits to expensive browser-facing operations.

## Cache policy per resource

Write down classification (public/private/request-local), audience, lifetime, keys, invalidation trigger, mutation refresh, and logout behavior. Use matching documentation for the selected Next version, Cache Components mode, and query library. Do not assume remembered defaults across versions.

Exclude private data from public/shared caches. Where private caching is intentionally supported, keys and access boundaries must preserve user/tenant separation. Request memoization is not permission to persist private results. Inspect the CDN, Next server, client query cache, and browser history as separate layers.

Test two identities, tenant switches if selected, logout, and re-login. Verify a successful mutation updates relevant server-rendered views and client queries, not just a toast. Do not add both SWR and TanStack for the same resource by default. A global cache reset is not a substitute for understanding invalidation.

## Mutation and navigation consistency

Map safe field errors back to fields; retain meaningful input after failures. Show pending feedback and prevent duplicate UI submissions while pending, but do not claim that prevents server duplicates. Use backend idempotency only when the API contract supports it; do not create pretend keys the server ignores.

Avoid stale responses overwriting newer user choices. Cancel obsolete reads or ignore obsolete results where appropriate. If optimistic updates are used, reconcile the confirmed response and rollback or offer recovery on failure. Retry only operations whose semantics permit replay.

Use URLs for shareable filters, pagination, and tabs. Preserve intended refresh and Back/Forward behavior. Bound query inputs, keep deterministic sorting, and distinguish empty from failed loading. Do not run writes in GET routes or rendering.

## Missing integration

With fixture-only or unavailable APIs, report UI results separately. Never count reload against an in-memory mock as proof of database persistence. Leave the real integration/security gates blocked and state the actual missing service/credentials/contract. Continue independent UI work without weakening security to unblock a demo.
