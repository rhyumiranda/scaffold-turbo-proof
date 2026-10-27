# Runtime and recovery

Read [production profiles](production-profiles.md) for opt-in OIDC sessions, immutable artifacts, two-instance verification, exported telemetry, accessibility and load checks.

## Run and package

`API_BASE_URL=https://api.example.invalid pnpm start` starts the standalone build. Replace the example origin with the selected API; credentials come from the selected server session integration, not the URL. `.env.example` contains names only. The Docker image runs the compiled standalone server as non-root. Build and smoke-test the image for the chosen target before claiming container readiness.

API_BASE_URL is server runtime configuration; no public secret or API bearer value is bundled. The starter has no public build-time environment values. Adding `NEXT_PUBLIC_*` requires documenting its build/promotion behavior.

## Observe safely

Each API call emits JSON: `event`, `requestId`, optional `traceId`, `operation`, `status`, `durationMs`, `outcome`. Search by request ID from the web response; the API receives the same correlation header. Treat it as diagnostic context, never as identity. Do not add cookies, user-provided project names, raw URLs, provider errors or authorization headers to logs.

To export traces and metrics, set `OTEL_EXPORTER_OTLP_ENDPOINT` to an approved HTTPS collector (loopback HTTP allowed locally) and optionally `OTEL_SERVICE_NAME`. An export allowlist excludes raw framework URLs, headers, events and error text. A periodic reader exports request-count/duration metrics. No collector is contacted when the endpoint is absent. Run test:telemetry; configure retention, access, alerts and owner with the deployment team.

## Release/rollback checklist

- Require the full static/runtime/real-integration workflow; build the artifact once and promote that tested artifact.
- Confirm provider session issuance/logout/refresh, HTTPS/proxy behavior, CSP in a production browser, secrets, origin policy and private cache isolation.
- Deploy only when authorized. Smoke-test list/create/rename using synthetic data in the selected non-production target first.
- On failure, return traffic to the last compatible artifact. This frontend owns no migrations; confirm upstream API contract compatibility before rollback.
- Check SIGTERM/drain behavior behind the actual load balancer and test dependency loss. Local termination success is not target drain proof.
- For multiple replicas, verify consistent action keys/build identity and cache invalidation; this reference does not configure a shared cache.

Deployment URL, on-call owner, SLO/alert thresholds, credential rotation and target recovery evidence are unresolved until a target is selected. Record them here; do not invent them or mark them passed from generated files.
