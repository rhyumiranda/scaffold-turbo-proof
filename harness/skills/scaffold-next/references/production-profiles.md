# Runtime profiles: executable, opt-in, evidence-backed

Read the generated [profile guide](../assets/reference/docs/production-profiles.md) before selecting these capabilities. It names exact code, environment settings, commands and limitations. Copy it with the reference; do not replace its implementations with fresh prose-derived substitutes.

The default external-cookie seam remains available for an existing API/provider. AUTH_MODE=oidc selects openid-client with server-side Redis sessions, stateless PKCE/state/nonce transactions in AES-256-GCM cookies (AUTH_TRANSACTION_SECRET), bounded rotating refresh and application logout. No vendor or Redis service is selected/provisioned automatically. The API still owns business data and independently validates access tokens.

## Phase additions

1. Intake: recover the chosen provider, access-token contract, hosting topology and existing infrastructure. If unset, keep the base profile and record unresolved choices; use isolated fixtures only for reference verification.
2. Identity: configure and run test:identity, then test:identity:browser against the actual supplied API test bootstrap. Keep vendor-specific consent, scopes, revocation and federation checks pending.
3. Replicas: configure build-time deployment ID/shared action key and run test:replicas. The harness renders on A and mutates on B. No-store private data needs no shared application cache; adding caching or rolling versions requires separate tests.
4. Runtime: run test:telemetry against a loopback receiver; inspect actual exported spans/metrics and redaction. Run bounded test:load only against an authorized URL with representative inputs/budgets.
5. Delivery: run test:container with a working daemon. A missing daemon is blocked, never a pass. Keep build output immutable at startup. The browser suite adds axe/text-reflow checks; manual Safari/screen-reader/native zoom checks remain separate.
6. Verification: record selected runtime names in selectedProfiles and observed paths in profileEvidence: oidc, replicas, redis-limiter, telemetry, recovery, container, load, accessibility as applicable. A blocked selected check keeps G06 blocked; successful local OIDC never promotes G04. Retain exact commands and outputs. G04 still requires the real selected provider, G08 a fresh independent adaptation, G09 the authorized deployment. Synthetic protocol/session success, local container smoke and a toy restore do not certify a deployed product.

## Do not erase project boundaries

Business authorization, actual provider credentials/policy, remote test infrastructure, design, data retention, traffic budgets, alert owners, hosted CI/branch policy, cloud credentials and recovery targets remain inputs. Optional payments/jobs/tenancy/webhooks/AI are still separate capabilities, not implied by these additions.

Framework sources: [OIDC client](https://github.com/panva/openid-client), [Redis client](https://github.com/redis/node-redis), [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [Nest rate limits](https://docs.nestjs.com/security/rate-limiting), [Playwright accessibility](https://playwright.dev/docs/accessibility-testing).
