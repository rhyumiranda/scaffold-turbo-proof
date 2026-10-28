# Optional capabilities

Read only for a selected requirement. These profiles are requirements and concrete acceptance examples, not prebuilt/tested reference extensions.

- Tenancy (S03): scope a project to a validated membership. Tenant B requesting Tenant A's record receives no record; jobs/cache/audit carry validated tenant context. Never accept x-tenant-id as authority.
- Idempotency (R03): same actor + key + payload returns the original result; changed payload with the same key is rejected; two concurrent submissions create one effect. Store identity/result atomically. Define expiry and in-progress recovery.
- Jobs/outbox (R04–R05): commit a requested export and its outbox row together; simulate a worker crash after delivery; a repeat must not produce duplicate effects. Bound concurrency/retries and expose failed-job replay. Never claim exactly-once external effects.
- Webhooks (R06): verify raw-byte signatures, reject stale/replayed messages per provider policy, persist before acknowledging, and deduplicate delivery. Test altered bytes, invalid signature, duplicate event, and crash/retry.
- Upload/email/payment adapters (N08): validate sizes/types/targets, scope access, time out, and map safe errors. Payment correctness and reconciliation are domain work; don't add sample live charges.
- AI runtime (L01–L10): isolate model calls; version prompts; schema-check outputs; evaluate real results. A summarize-project operation may read only the caller's authorized project. Test malformed output, malicious retrieved text, missing permissions, timeout, cancellation, budget exhaustion, and provider unavailability. Model text cannot grant tool access. Retrieval must enforce ACLs before model access. Define trace retention, rollout/rollback, cost/time/step limits, and a disable switch.
- Agent-ready engineering (A01–A08) is always included; none of the above is implied by AI-assisted coding.

Apply only supported combinations. A new combination is unverified until it passes the appropriate real-dependency and failure tests; do not advertise it as tested by the base reference.
