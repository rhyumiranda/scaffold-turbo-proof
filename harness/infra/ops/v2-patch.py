# AC-87: the "v2" release = an additive migration (nullable column) plus code that writes it. Usage: v2-patch.py REPO
import sys, pathlib
r = pathlib.Path(sys.argv[1])
(r / 'apps/api/migrations/002-projects-renamed-at.sql').write_text('ALTER TABLE projects ADD COLUMN renamed_at timestamptz;\n')
p = r / 'apps/api/src/projects/service.ts'
t = p.read_text()
old = "'UPDATE projects SET name=$3, version=version+1 WHERE id=$1"
assert old in t
p.write_text(t.replace(old, "'UPDATE projects SET name=$3, version=version+1, renamed_at=now() WHERE id=$1"))
