# First feature contract

Complete this record from the actual request before inventing entities, operations, or permissions.

- Product purpose:
- Resource and key fields:
- Actors and identity source:
- Ownership/membership/access rules:
- Allowed operations (do not assume all CRUD):
- Forbidden operations:
- State transitions and invariants:
- Validation and output fields:
- Deletion/retention policy:
- Concurrency/idempotency behavior:
- API/schema version and error contract:
- UI routes/states and cache audience, if applicable:
- Selected infrastructure/profiles:
- Authentication integration and unresolved decisions:
- Deployment intent and non-goals:

## Acceptance examples

Describe concrete input, actor, expected response/state, and persisted result for:
1. Successful operation.
2. Invalid input.
3. Unauthenticated or unauthorized operation.
4. Another actor's record, where applicable.
5. Repeated operation or competing write.
6. Dependency failure and recovery.

The bundled projects example is user-owned create/list/read/rename with expectedVersion conflict checks. Keep it only if suitable; adapt its tests with the domain. Deletion and tenant policy are deliberately not inferred.
