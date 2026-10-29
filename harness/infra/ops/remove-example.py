# AC-90: apply the edits docs/replacing-the-example.md step 2 lists (no-feature path). Usage: remove-example.py REPO
import sys, pathlib
r = pathlib.Path(sys.argv[1])
def edit(path, pairs):
    p = r / path; t = p.read_text()
    for old, new in pairs:
        assert old in t, (path, old)
        t = t.replace(old, new)
    p.write_text(t)
edit('apps/api/src/app.ts', [
    ("import { ProjectsModule } from './projects/index.js';\n", ''),
    ("    ProjectsModule,\n", ''),
    ("setTitle('Projects reference')", "setTitle('Acme API')"),
])
edit('apps/web/package.json', [
    (' scripts/projects-navigation.test.mjs', ''),
])
edit('apps/web/src/lib/feature-routes.mjs', [
    ("export const homePath = '/projects';", "export const homePath = '/';"),
    ("export const privatePaths = [/^\\/projects(\\/|$)/];", "export const privatePaths = [];"),
    ("export const operations = ['projects.list', 'projects.read', 'projects.create', 'projects.rename'];", "export const operations = [];"),
])
(r / 'apps/web/src/app/page.tsx').write_text("export default function Home() {\n  return (\n    <main>\n      <h1>Acme</h1>\n      <p>No feature yet.</p>\n    </main>\n  );\n}\n")
edit('apps/web/src/app/layout.tsx', [("title: { default: 'Projects reference', template: '%s · Projects reference' }", "title: { default: 'Acme', template: '%s · Acme' }")])
edit('apps/api/AGENTS.md', [(", then the [projects flow](docs/features/projects.md)", "")])
edit('apps/web/AGENTS.md', [("- Read [the projects flow](docs/features/projects.md) before changing behavior; update it with the code.\n", "")])
edit('apps/api/docs/architecture.md', [
    ("composes `ProjectsModule`, `PlatformModule`", "composes `PlatformModule`"),
    ("`src/projects/` owns controller", "A feature folder (none yet) owns controller"),
])
edit('apps/web/docs/architecture.md', [
    ("| Server-rendered list/detail | `src/app/projects/` | `services/projects.server.ts` |\n| Interactive form | `components/project-form.tsx` | `hooks/use-project-form.ts` |\n| Form state/focus and action choice | `hooks/use-project-form.ts` | `actions/projects.ts` |\n| Session preflight | `hooks/use-project-form.ts` | `services/session.browser.ts` |\n| Validated mutation | `actions/projects.ts` | server service |\n| Typed transport | `services/projects.server.ts` | external API |\n",
     "| None yet | `src/features/<name>/` | add your feature here |\n"),
    ("All feature paths above live under `src/features/projects/` except routes.", "Feature paths live under `src/features/<name>/` except routes (no feature yet)."),
])
p = r / 'apps/api/docs/decisions.md'
p.write_text(p.read_text() + "\n## Removed the Projects example (unreleased API)\n\nThe Projects example was removed before any client used the API, so the accepted contract baseline was reset to the new schema (docs/replacing-the-example.md step 3).\n")
