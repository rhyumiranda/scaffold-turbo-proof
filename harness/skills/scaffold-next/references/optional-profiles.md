# Optional frontend capabilities

Read only for a selected product requirement. These are acceptance examples, not prebuilt/tested reference extensions.

- Tenancy (S03): switching from A to B must remove A's private query/cache/UI state, and the API must validate B membership. Test direct URLs, Back/Forward, and another tab; a selected tenant in client state is not permission.
- Client queries: add the browser-service → GET adapter path only for interactive refetch/pagination requirements. Abort or ignore obsolete results; one query library owns each resource. Test rapid filter changes arriving out of order.
- Upload/realtime/jobs: the backend owns permission, durable effects, and replay semantics. The UI shows progress, cancellation where supported, disconnection/retry, and recovery; do not imply a button cancels committed backend work. Test duplicate callbacks and revoked access.
- Optimistic mutations: reconcile canonical responses and roll back or provide recovery after failure. Never present speculative state as confirmed persistence.
- AI runtime (L01–L10): keep providers/tools and their authority behind the API. Render model content safely, distinguish suggestions from committed actions, and implement streaming/cancel/error/budget states. Test malformed data, injected content, permission denial, cancellation, and unavailable providers. Do not add a paid provider, retrieval database, or autonomous tool loop by default.
- AI server responsibilities remain explicit: model adapter, schema validation, prompt/evaluation versions, outcome-based evaluations, allowed tools and permissions, injection containment, bounded execution, retrieval ACL/provenance, privacy/trace policy, and controlled rollout. The frontend cannot certify these with mocked responses.

Agent-ready engineering (A01–A08) stays baseline. Select a profile only for a real need; record what is tested locally versus supplied by the upstream API.
