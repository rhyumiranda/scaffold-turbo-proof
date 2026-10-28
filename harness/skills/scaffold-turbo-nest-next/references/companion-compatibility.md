# Companion compatibility

The executable adapter is tested only with:

| Companion | Reference version | Standalone package manager | Runtime |
|---|---:|---:|---:|
| `scaffold-nest` | `1.4.0` | `npm@11.17.0` | `24.22.1` |
| `scaffold-next` | `1.4.0` | `npm@11.17.0` | `24.22.1` |

Default locations are the sibling directories of this skill, so one install never mixes companion versions from another:

```text
<skills-dir>/scaffold-nest
<skills-dir>/scaffold-next
```

Pass `--nest-skill` and `--next-skill` to use other copies.

The scaffold script accepts `--nest-skill` and `--next-skill` absolute overrides. It invokes each companion generator in a temporary directory, reads the generated source manifest, and fails before finalization when the matrix differs.

The adapter intentionally removes standalone ownership files: nested lockfiles, nested `packageManager`, standalone workflows, Git-root ignores, standalone npm configuration, standalone runtime pin, standalone Dockerfile, and standalone shared-config entrypoints. It replaces them with workspace-owned equivalents.

Do not expand the accepted matrix because a version number looks close. Inspect changes, update adapters, regenerate the root lockfile, run all checks, and record the new evidence.

Preferred future migration: add a tested `--mode workspace-package` to both companion generators. Once it produces equivalent outputs and evidence, delete the transformations it replaces.

## Toolchain decisions

- TypeScript stays on 5.9.3 because typescript-eslint 8.72 supports only `<6.1.0`. Revisit when it supports TypeScript 7.
- CI pins `pnpm/action-setup` v6.1.0, the first release that supports pnpm 12. Earlier v4 pins could not install pnpm 12.
- Adopt a dependency release only after it is 24 hours old. `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`, and Dependabot uses a one-day cooldown. A clean install, Docker build or CI run fails on younger packages even when a local store already holds them.
