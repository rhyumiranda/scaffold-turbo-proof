# AC-87: the "v2" release = an additive migration (nullable column) plus code that writes it. Usage: v2-patch.py REPO
import sys, pathlib

r = pathlib.Path(sys.argv[1])

def edit(path, old, new):
    p = r / path
    source = p.read_text()
    assert source.count(old) == 1, (path, old)
    p.write_text(source.replace(old, new, 1))

migration = r / 'apps/api/prisma/migrations/0002_projects_renamed_at/migration.sql'
migration.parent.mkdir(parents=True)
migration.write_text('BEGIN;\n\nALTER TABLE "projects" ADD COLUMN "renamed_at" TIMESTAMPTZ(6);\n\nCOMMIT;\n')
edit(
    'apps/api/prisma/schema/projects/projects.prisma',
    '  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)\n',
    '  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)\n  renamedAt DateTime? @map("renamed_at") @db.Timestamptz(6)\n',
)
edit(
    'apps/api/src/projects/repository.ts',
    '        data: { name, version: { increment: 1 } },',
    '        data: { name, version: { increment: 1 }, renamedAt: new Date() },',
)
