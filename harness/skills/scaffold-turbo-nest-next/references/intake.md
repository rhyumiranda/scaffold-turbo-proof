# Intake

Resolve only decisions that materially change the generated workspace:

- absolute new destination and repository name;
- actual domain journey or explicit removable Projects example;
- actors, allowed operations, ownership, deletion policy, and data sensitivity;
- identity provider and session boundary, or explicitly unresolved provider seam;
- database/provider and confirmed disposable integration database;
- pnpm default or requested package-manager adaptation;
- Node/runtime and delivery target;
- optional tenancy, jobs, uploads, realtime, AI, or additional applications.

Default when not contradicted: pnpm; Node 24.22.1; `apps/api`; `apps/web`; `packages/api-client`; `packages/eslint-config`; `packages/typescript-config`; no deletion; no direct browser-to-Nest transport; no deployment provider.

## Record the answers

Write the answers to a JSON file and pass it with `--intake /absolute/intake.json`. The generator rejects unknown fields and invalid values, shows the answers in the dry-run preview, and stores them in `scaffold-manifest.json` under `intake`. Without the flag, `intake` is `null` and auth stays `provider-configuration-required`.

```json
{
  "journey": "Owners create, list, read and rename their projects",
  "actors": ["signed-in owner"],
  "auth": "oidc",
  "database": "postgresql",
  "deletion": "none",
  "deployment": "containers",
  "optionalProfiles": []
}
```

| Field | Allowed values |
|---|---|
| `journey` | 1–200 characters |
| `actors` | non-empty list of names, each up to 80 characters |
| `auth` | `external-cookie`, `oidc`, `unresolved` |
| `database` | `postgresql` (the only tested database) |
| `deletion` | `none`, `owner-only`, `policy-defined` |
| `deployment` | `none`, `containers` |
| `optionalProfiles` | any of `tenancy`, `jobs`, `uploads`, `realtime`, `ai` |

The answers record intent; they do not change generated files. Both Dockerfiles are always generated as local packaging, and CI always builds them. `deployment` records whether you intend to ship them. Selected `auth` and `optionalProfiles` still need their own implementation and evidence before the related gates pass.

Do not ask again for decisions already established in the conversation or project instructions. Dry run writes nothing.
