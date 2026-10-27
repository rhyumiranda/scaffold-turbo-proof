# Operations

Commands run from the repository root unless a section says otherwise. Blocks marked **target** need your real hosting platform and cannot be proven on a laptop.

## Local setup and checks

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm boundaries
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm contract:check
```

Each app documents its own variables: `apps/api/docs/environment.md` and `apps/web/docs/environment.md`. Database-backed tests need a disposable PostgreSQL database whose name ends in `_test`, and `NODE_ENV=test`; they refuse anything else.

## Health and smoke checks

| Check | URL | Meaning |
|---|---|---|
| API liveness | `GET /health/live` on the API | Process is running. Stays 200 when the database is down; restart only if this fails. |
| API readiness | `GET /health/ready` on the API | Database (and the Redis limiter, if used) answers. 503 means stop routing traffic here. |
| Web liveness | `GET /healthz` on the web app | Process is running. Needs no session and no API, so it stays 200 during API or identity outages. |

Smoke test against a running stack (set the two origins first):

```bash
API=http://127.0.0.1:4100 WEB=http://127.0.0.1:3000 sh -c 'curl -fsS "$API/health/ready" && curl -fsS "$WEB/healthz" && curl -fsS -o /dev/null -w "%{http_code}\n" "$WEB/projects"'
```

`/projects` answers 200 (external-cookie mode, sign-in page) or 307 to `/auth/login` (OIDC mode, no session).

## Container images

Build from the repository root. The web build takes the Server Action key as a BuildKit secret, never a build argument:

```bash
docker build -f apps/api/Dockerfile --target runtime -t acme-api .
docker build -f apps/api/Dockerfile --target migrate -t acme-api-migrate .
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$(openssl rand -base64 32)" docker build -f apps/web/Dockerfile --secret id=next_action_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY --build-arg APP_DEPLOYMENT_ID=local-1 -t acme-web .
```

- Base images are pinned by digest; Dependabot proposes digest updates for both Dockerfiles.
- Code and dependencies are owned by root; the processes run as `node` (UID 1000) and cannot modify them.
- Both images run with `--read-only --cap-drop ALL --security-opt no-new-privileges`. No writable path is required; add `--tmpfs /tmp` only if you add code that writes temporary files.
- **The web image is secret-bearing.** Next.js embeds `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` in the server bundle at build time. It never appears in layer history or image environment, but anyone who can pull the image can extract it. Restrict registry pull access to the deployment platform, and rotate the key by rebuilding (see rotation below).
- SBOMs: `pnpm run sbom` (plain `pnpm sbom` runs pnpm's own built-in command instead) builds both runtime images and writes `sbom/api.spdx.json` and `sbom/web.spdx.json` with a digest-pinned Syft. CI uploads them as the `sbom` artifact.

## Release order and rollback

1. Build and push the three images (API runtime, API migrate, web), and record their digests.
2. Run the migrate image **once** with a migration-only database credential. It exits 0 when every migration is applied; it is safe to re-run and holds an advisory lock against concurrent runs.
3. Roll out the API. Wait until every replica's `/health/ready` is 200.
4. Roll out the web app.

Rollback reverses steps 4 and 3 (web first, then API) to the previous digests. Never roll back a migration: schema changes follow expand/contract. Ship an additive change (new nullable column, new table) first, deploy code that uses it, and remove the old shape only in a later release once no running version needs it. Then the previous API version keeps working against the newer schema, which is what makes an application rollback safe.

## Backup and restore

Rehearse a logical restore into a fresh, throwaway cluster through the migration runner. It needs PostgreSQL client tools of the same major version as the server (`pg_config --version`):

```bash
cd apps/api && PG_BIN="$(pg_config --bindir)" NODE_ENV=test DATABASE_URL="$DATABASE_URL" pnpm test:recovery
```

The drill compares row counts and content hashes in UTC and leaves the restored cluster under `$TMPDIR/scaffold-restore-*` for inspection. Use a disposable `*_test` database as the source.

**target** — Set these with the database owner before launch, then rehearse on the real platform:

| Item | Value |
|---|---|
| Recovery point objective (RPO) | _placeholder — owner: ______ |
| Recovery time objective (RTO) | _placeholder — owner: ______ |
| Backup schedule, encryption and retention | _placeholder — owner: ______ |

## Service-level indicators

Targets are placeholders until the product owner agrees them. Each indicator uses a signal both apps already emit.

| Indicator | Signal | Placeholder target |
|---|---|---|
| Availability | `http.server.requests` counter (API, OTLP): share with `http.response.status_code` below 500. Without OTLP: `request.complete` log lines with `status` below 500 (both apps) | 99.9% over 30 days |
| Latency | `http.server.duration` histogram (API, OTLP), 95th percentile per `http.route`; or `durationMs` in API `request.complete` logs | p95 below 300 ms |
| Error rate | Count of `request.complete` lines with `level: "error"` (status 500 or above) per minute, both apps | below 0.1% of requests |

Every log line is one JSON object with `time`, `level`, `service` and `event`. Requests carry `x-request-id`; the API also returns `x-trace-id` when telemetry export is on.

## Incident triage

| Situation | What you see | First action | Recovery |
|---|---|---|---|
| Database down or too slow | API `/health/ready` 503 within seconds; API answers 503 problem+json with `Retry-After`; `database.query_failure` log events; web `/projects` shows "Projects unavailable" with a Try again button | Check the database host and connection count; do not restart the API (liveness stays 200) | Automatic once the database answers: readiness returns to 200 without a restart |
| Redis (web sessions) down | Sign-in and signed-in pages fail; web logs `framework.log` errors from the session store; `/healthz` stays 200 | Restore Redis; sessions in it are lost only if Redis data was lost | Automatic reconnect; users whose session data was lost sign in again |
| Redis (API limiter, `LIMITER_MODE=redis`) down | API `/health/ready` 503 and requests 503 (fails closed, never unlimited) | Restore Redis | Automatic |
| Identity provider down | New sign-ins land on `/sign-in-problem?reason=unavailable` (the web app re-checks the provider at most every 5 s, so the first sign-ins after an outage starts may still be sent to it); existing sessions keep working until their access token needs a refresh; the API keeps accepting valid tokens with its cached signing keys | Check the provider's status | Automatic; users retry sign-in from the problem page |
| API overloaded | 503 with `Retry-After: 1` from the in-flight limit, or 429 with `Retry-After` from rate limits; `http.server.overloaded` metric rises; liveness stays 200 | Scale out the API, or raise `MAX_IN_FLIGHT` only if the database has headroom | Clears as load drops |

## Secret rotation

| Secret | Procedure |
|---|---|
| Database password (`DATABASE_URL`) | Create the new password on the database role (most platforms allow two valid credentials during a rotation), update the secret store, roll the API one replica at a time, confirm readiness, then revoke the old credential. Rotate the migration credential the same way before the next release. |
| `AUTH_CLIENT_SECRET` | Generate a second client secret at the identity provider (or a new client with the same redirect URIs), update the secret store, roll the web app, confirm sign-in, then delete the old secret. Existing sessions are unaffected. |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Generate a new key (`openssl rand -base64 32`), rebuild the web image with it and a new `APP_DEPLOYMENT_ID`, and roll every web replica to that image. Forms rendered by the old build fail once; users reload and submit again. Then revoke pull access to the old image. |
| Redis credentials (`AUTH_REDIS_URL`, `LIMITER_REDIS_URL`) | Add a second password to the Redis ACL user, update the secret store, roll the web app and API, then remove the old password. |
| OTLP collector credentials | Endpoint URLs must not contain credentials. Authenticate at the collector (mutual TLS or a local agent) and rotate there; the apps need no change. |

## Branch protection

**target** — After creating the repository, protect `main`:

- Require a pull request with at least one approving review before merging.
- Require the status check **`verify`** to pass. It is the `verify` job of the workflow "Verify workspace" (`.github/workflows/verify.yml`). GitHub names the check after the job id, so renaming the job changes the required check name; update the rule in the same change.
- Block force pushes and branch deletion.

## Remote cache (optional)

Turborepo's remote cache is off by default. `turbo.json` already sets `"remoteCache": { "signature": true }`, so once enabled every artifact is signed and an unsigned or tampered one is rejected and rebuilt.

```bash
export TURBO_API="https://cache.example.internal" TURBO_TEAM="acme" TURBO_TOKEN="<from secret store>"
export TURBO_REMOTE_CACHE_SIGNATURE_KEY="$(openssl rand -base64 48)"
pnpm build
```

- Keep `TURBO_REMOTE_CACHE_SIGNATURE_KEY` at least 32 bytes and in the secret store; every machine that reads or writes the cache needs the same key.
- Give pull-request jobs from forks read-only or no cache access, so an untrusted job can never write an artifact that a release build restores.
- The server must keep the `x-artifact-tag` header it receives. A server that drops it makes every artifact fail verification: builds stay correct, but nothing is reused.

## Removing the Projects example

See `docs/replacing-the-example.md`.
