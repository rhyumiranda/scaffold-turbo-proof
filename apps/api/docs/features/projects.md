# Projects: removable complete slice

Actor: authenticated user identified by verified JWT subject. Operations: create, list, read, rename. No delete, shared ownership, tenant membership or automatic CRUD over other tables.

1. Controller validates DTO/path/query and extracts verified subject.
2. Service uses that subject in every read/write predicate; clients cannot set owner_id.
3. Create trims a nonempty name up to 100 characters and persists version 1. Output contains id/name/version/createdAt only.
4. List orders by created_at/id and allows integer limit 1–100, offset 0–10000.
5. Read another user's or absent UUID returns 404.
6. Rename atomically matches id + owner + expectedVersion. One competing writer wins; the loser receives 409. The client must reload/reconcile, never blindly replay.

Tests: `test/api.test.mjs` performs real HTTP plus PostgreSQL, validates actual bodies against OpenAPI, checks authority, malformed input, persistence and competing writes. `test/contracts.unit.test.mjs` rejects deliberately broken schema fixtures. `test/migrations.test.mjs` proves clean install, compatible upgrade, failed-migration rollback and applied-checksum protection in isolated test schemas created through migrations.

When replacing Projects, update its module/DTO/service, constraints/indexes/migrations, contract/client, feature flow and equivalent negative tests together. Existing ownership is an example policy, not permission to invent the new product's rules.

## Duplicate submissions and retries

`POST /v1/projects` is not idempotent: each accepted request creates a new project. The web form disables its submit button while a request is in flight, so a double-click or a second Enter creates one project. Neither the web app nor the API retries a write automatically. After a timeout or a 5xx on create or rename, the write may already have been saved: the form says so and keeps the input; reload the list before submitting again. Rename is safe to retry with the same `expectedVersion`: a second attempt after a saved first one gets 409.
