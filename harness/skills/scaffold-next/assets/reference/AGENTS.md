# Project map

- Read [architecture](docs/architecture.md) before imports or transport changes.
- Read [the projects flow](docs/features/projects.md) before changing behavior; update it with the code.
- Read [testing](docs/testing.md) for exact commands and isolated real-API setup.
- Read [security verification](docs/security-verification.md); run `npm run check:secrets` before handoff.
- Record consequential choices in [decisions](docs/decisions.md); deployment facts belong in [operations](docs/operations.md).
- Run `npm run lint`, `npm run test:unit`, `npm run check:docs`, `npm run typecheck`, `npm run build`, `npm run check:budget`, `npm run test:runtime`, and `npm run test:integration`. Missing API bootstrap blocks integration; do not replace it with a mock or skip.
- This frontend has no database authority. Keep credentials in server services and enforce resource permissions in the supplied API. Client state and hidden fields never confer authority.
- Keep Server Component reads direct to server services. Client reads use hooks/browser services. Client mutations go component → hook → Server Action → server service; only the hook imports the action, and `npm run check:arch` fails otherwise. Do not create empty layers.
- Keep the generated contract untouched by hand. Update the source schema intentionally and run `npm run contract`; review compatibility before accepting a changed baseline.
- Never infer permission to deploy, create cloud resources, commit, or use production data from these setup instructions.

## Identity integration

- Default `AUTH_MODE=external-cookie`: the app reads an API-issued bearer token from the HttpOnly `api_session` cookie and issues no cookie itself. Use it when another system owns login.
- `AUTH_MODE=oidc`: `src/lib/identity.ts` and `src/app/auth/[operation]/route.ts` implement login, callback, refresh and logout with PKCE, single-use transactions and Redis sessions. See `docs/production-profiles.md`.
- Either way, choose the provider, register the callback, and verify consent, refresh, revocation and account switching against that provider before calling the app complete. Local OIDC tests use a test issuer, not a real provider.
