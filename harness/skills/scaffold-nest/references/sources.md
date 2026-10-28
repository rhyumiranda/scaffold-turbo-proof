# Source and version policy

Research captured 2026-10-26; skills/reference package assembled 2026-10-27. This is a bounded engineering synthesis, not a complete borrowed corpus or one company's endorsed architecture. Preserve distinctions between framework behavior, proposed defaults, and explicit user rules. The four-layer frontend and restricted Prisma workflow are user rules. Domain modules, API-backed Next, and this example's ownership policy are selected architecture/examples.

## Rechecked in this implementation

- Next data security and Playwright production testing: 2026-10-27.
- Nest ValidationPipe and shutdown hooks: 2026-10-27.
- Exact dependency versions/peer ranges checked against the npm registry; lockfiles and validation results are recorded with the reference.
- Multer patched dependency pinned to 2.5.0 after [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m).
- Zod reference pinned to 4.6.7 after [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).

## Primary reading by requirement

Use the relevant source for an implementation decision; do not load every document. Recheck versions/security advisories before updating the reference, and rerun all affected tests. Unversioned documentation can move or describe a newer release. Prisma's migration reference previously redirected to v7; never mix major-version migration commands. No production provider has been selected or verified.

- [Google SRE: implementing SLOs](https://sre.google/workbook/implementing-slos/)
- [Nest modules](https://docs.nestjs.com/modules)
- [Next data security](https://nextjs.org/docs/app/guides/data-security)
- [Next Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next production checklist](https://nextjs.org/docs/app/guides/production-checklist)
- [Node releases](https://nodejs.org/en/about/previous-releases)
- [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict.html)
- [indexed access](https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html)
- [optional properties](https://www.typescriptlang.org/tsconfig/exactOptionalPropertyTypes.html)
- [Validation](https://docs.nestjs.com/techniques/validation)
- [configuration](https://docs.nestjs.com/techniques/configuration)
- [OpenAPI](https://docs.nestjs.com/openapi/introduction)
- [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html)
- [Nest authorization](https://docs.nestjs.com/security/authorization)
- [rate limiting](https://docs.nestjs.com/security/rate-limiting)
- [OWASP ASVS](https://asvs.owasp.org/)
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
- [Versioned Prisma migration commands](https://docs.prisma.io/docs/cli/v7/migrate)
- [PostgreSQL PITR](https://www.postgresql.org/docs/current/continuous-archiving.html)
- [Nest lifecycle](https://docs.nestjs.com/fundamentals/lifecycle-events)
- [health checks](https://docs.nestjs.com/reliability/terminus)
- [Nest outbox](https://docs.nestjs.com/reliability/outbox)
- [Nest queues](https://docs.nestjs.com/application/queues)
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [Current caching](https://nextjs.org/docs/app/getting-started/caching)
- [previous caching model](https://nextjs.org/docs/app/guides/caching-without-cache-components)
- [Next self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [WCAG quick reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [Web Vitals](https://web.dev/articles/vitals)
- [Nest testing](https://docs.nestjs.com/fundamentals/testing)
- [Next Playwright guidance](https://nextjs.org/docs/app/guides/testing/playwright)
- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)
- [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub OIDC](https://docs.github.com/en/actions/concepts/security/openid-connect)
- [OpenAI harness engineering](https://openai.com/index/harness-engineering/)
- [Anthropic context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)
- [Anthropic building effective agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic agent evaluations](https://www.anthropic.com/research/demystifying-evals-for-ai-agents)
- [OWASP prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP excessive agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
