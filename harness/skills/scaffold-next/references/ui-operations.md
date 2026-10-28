# UI completeness, performance, and operations

Read for phases 7–9. Follow applicable project UI rules; these are a compact execution checklist, not a replacement for the user's full design instructions.

## Complete states and accessible interaction

Use existing tokens/components/branding. Implement loading, empty, sparse/dense, error, not found, forbidden, expired-session, and recovery states. Match skeleton geometry to content. Preserve useful input on failure. Show a clear next action rather than a dead end.

Use native links/buttons/labels with meaningful accessible names. Support keyboard navigation and visible unobscured focus; manage focus in overlays and after form errors. Allow paste and password managers. Use appropriate input types/autocomplete and hydration-safe inputs. Keep submit available until a request starts, then show a spinner with its original label. Associate field errors and focus the first invalid field. Announce nonurgent feedback politely.

Support zoom, reduced motion, mobile safe areas, long content, and empty arrays/strings. Use project target sizes (minimum 24px, mobile 44px under the user's rules); mobile inputs at least 16px. Warn on unsaved changes where applicable. If destructive actions exist, use the required confirmation or Undo behavior; do not invent deletion.

Verify mobile, laptop, and ultrawide; test keyboard, labels/contrast, and relevant assistive-tech behavior. Automated accessibility checks alone do not establish WCAG conformance. Do not claim manual screen-reader verification when it was not run.

## Performance and metadata

Measure production builds under representative CPU/network settings. Inspect client bundles and rerenders; optimize only measured risks. Keep client boundaries small, reserve image dimensions, prioritize above-fold media, defer the rest, and use a deliberate font strategy. Bound long lists; the user's policy calls for virtualization over 50 rendered items, with keyboard/accessibility preservation.

Avoid layout-prop animations and transition: all under the user's UI rules. Respect reduced motion and preserve useful interaction. Prefer layout CSS over synchronous measurements. Track latency, hydration warnings, layout shifts, and route transitions.

Provide context-specific titles, public metadata, and appropriate indexing policy without exposing private content. Record performance budgets and device/data assumptions. Core Web Vitals good thresholds from the research are p75 LCP <=2.5s, INP <=200ms, CLS <=0.1; recheck current guidance when applying. Lab results cannot establish actual-user percentiles.

## Production runtime and delivery

Run end-to-end browser checks against compiled production code, not just a development server. Next's Playwright guidance recommends production-code testing. [Playwright](https://nextjs.org/docs/app/guides/testing/playwright)

Build CI gates for lint, explicit types, generated-contract drift, unit/integration/browser tests, dependency checks, and production builds. Pin workflow actions and keep PR code away from privileged credentials. Use least privilege; no cloud creation or deployment is implied.

Choose hosting intentionally. For container profiles use a reproducible locked build and non-root runtime; managed hosting may require a different artifact. Public environment values may be baked into builds, so document promotion/config constraints.

For multi-instance hosting, test cache sharing/invalidation, consistent builds, Server Action encryption configuration when required, and version-skew behavior against matching documentation. Installing Redis alone does not prove cache correctness.

Provide safe server logs and request correlation; use supported tracing integration rather than assuming every browser SDK is stable. Define health/smoke checks appropriate to hosting, lifecycle handling, release/rollback steps, monitoring owners, and incident instructions. Target smoke/load/alerts and real-user metrics require actual deployment evidence, not generated config.
