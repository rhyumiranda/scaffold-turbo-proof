# Runtime profiles: executable, opt-in, evidence-backed

Read the generated [profile guide](../assets/reference/docs/production-profiles.md) before selecting these capabilities. It names exact code, environment settings, commands and limitations. Copy it with the reference; do not replace its implementations with fresh prose-derived substitutes.

The JWT boundary remains provider-configurable. Request capacity and JWKS cache settings are bounded. LIMITER_MODE=redis selects shared atomic limiting; memory remains the single-process default. TRUST_PROXY_CIDRS must come from actual topology, not a guessed trust-all setting.

## Phase additions

1. Intake: recover the chosen provider, access-token contract, hosting topology and existing infrastructure. If unset, keep the base profile and record unresolved choices; use isolated fixtures only for reference verification.
2. Identity: run test:integration for real-key rotation/outage tests. JWT snapshots are not immediate revocation; implement an introspection profile only if the product requires it.
3. Replicas: set the selected limiter settings and run test:profiles with isolated Redis/database. Confirm shared quota, untrusted forwarding headers, dependency readiness and fail-closed behavior.
4. Runtime: run test:telemetry against a loopback receiver; inspect actual exported spans/metrics and redaction. Run bounded test:load only against an authorized URL with representative inputs/budgets.
5. Delivery: run test:container with a working daemon. A missing daemon is blocked, never a pass. Run test:recovery with a dedicated loopback source and compatible PostgreSQL tools; it restores into a new owned cluster via migrations, compares data and stops that cluster.
6. Verification: record selected runtime names in selectedProfiles and observed paths in profileEvidence: oidc, replicas, redis-limiter, telemetry, recovery, container, load, accessibility as applicable. A blocked selected check keeps G06 blocked; successful local OIDC never promotes G04. Retain exact commands and outputs. G04 still requires the real selected provider, G08 a fresh independent adaptation, G09 the authorized deployment. Synthetic protocol/session success, local container smoke and a toy restore do not certify a deployed product.

## Do not erase project boundaries

Business authorization, actual provider credentials/policy, remote test infrastructure, design, data retention, traffic budgets, alert owners, hosted CI/branch policy, cloud credentials and recovery targets remain inputs. Optional payments/jobs/tenancy/webhooks/AI are still separate capabilities, not implied by these additions.

Framework sources: [OIDC client](https://github.com/panva/openid-client), [Redis client](https://github.com/redis/node-redis), [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [Nest rate limits](https://docs.nestjs.com/security/rate-limiting), [Playwright accessibility](https://playwright.dev/docs/accessibility-testing).
