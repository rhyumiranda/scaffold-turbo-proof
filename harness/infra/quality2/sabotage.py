import os
import re
import sys

n = int(sys.argv[1]); root = sys.argv[2]
def edit(path, old, new):
    p = os.path.join(root, path); s = open(p).read()
    assert s.count(old) == 1, (path, old)
    open(p, 'w').write(s.replace(old, new, 1))

def sabotage_headers():
    logging_path = os.path.join(root, 'apps/api/src/platform/logging.ts')
    telemetry_path = os.path.join(root, 'apps/api/src/platform/telemetry.ts')
    with open(logging_path) as source:
        logging = source.read()
    with open(telemetry_path) as source:
        telemetry = source.read()

    fields = list(re.finditer(r'type\s+Fields\s*=\s*\{(?P<body>.*?)^\};', logging, re.MULTILINE | re.DOTALL))
    assert len(fields) == 1, ('logging.ts', 'unique Fields type', len(fields))
    fields_body = fields[0].group('body')
    subject = list(re.finditer(r'^(?P<indent>[ \t]*)subject\?:\s*string;[ \t]*$', fields_body, re.MULTILINE))
    assert len(subject) == 1, ('logging.ts', 'unique Fields.subject', len(subject))
    assert not re.search(r'^\s*headers\?:', fields_body, re.MULTILINE), ('logging.ts', 'headers already allowlisted')
    subject_line = subject[0].group(0)
    new_fields_body = (
        fields_body[:subject[0].start()]
        + subject_line
        + f"\n{subject[0].group('indent')}headers?: unknown;"
        + fields_body[subject[0].end():]
    )
    logging_new = logging[:fields[0].start('body')] + new_fields_body + logging[fields[0].end('body'):]

    calls = list(re.finditer(
        r"logEvent\(\s*['\"]request\.complete['\"]\s*,\s*\{(?P<body>.*?)^(?P<close>[ \t]*)\}\s*\)\s*;",
        telemetry,
        re.MULTILINE | re.DOTALL,
    ))
    assert len(calls) == 1, ('telemetry.ts', 'unique request.complete log object', len(calls))
    call_body = calls[0].group('body')
    assert 'request.headers' not in call_body, ('telemetry.ts', 'request headers already logged')
    member = re.search(r'^(?P<indent>[ \t]*)requestId\s*,[ \t]*$', call_body, re.MULTILINE)
    assert member is not None, ('telemetry.ts', 'request.complete requestId member')
    request_id_line = member.group(0)
    new_call_body = (
        call_body[:member.start()]
        + request_id_line
        + f"\n{member.group('indent')}headers: request.headers,"
        + call_body[member.end():]
    )
    telemetry_new = telemetry[:calls[0].start('body')] + new_call_body + telemetry[calls[0].end('body'):]

    # Both transforms are validated before either file is changed.
    with open(logging_path, 'w') as destination:
        destination.write(logging_new)
    with open(telemetry_path, 'w') as destination:
        destination.write(telemetry_new)
if n == 1:  # read query loses the owner_id condition
    edit('apps/api/src/projects/repository.ts', "where: { id, ownerId }, select: columns", "where: { id }, select: columns")
elif n == 2:  # rename UPDATE loses the version condition
    edit('apps/api/src/projects/repository.ts', ' AND "version" = ${version}', '')
elif n == 3:
    edit('apps/api/src/app.ts', 'forbidNonWhitelisted: true,', 'forbidNonWhitelisted: false,')
elif n == 4:
    edit('apps/api/src/platform/auth.ts', "        audience: this.config.audience,\n", "")
elif n == 5:  # readiness is unconditional (references kept so build and lint stay clean)
    edit('apps/api/src/platform/health.ts', "    try {\n      await Promise.all([this.db.ping(), this.limiter.ready()]);\n      return { status: 'ready' };\n    } catch {\n      throw new ServiceUnavailableException();\n    }", "    const keep = [this.db, this.limiter, ServiceUnavailableException];\n    if (keep.length === 0) throw new ServiceUnavailableException();\n    await Promise.resolve();\n    return { status: 'ready' };")
elif n == 6:  # drop server-only and import the server module from a client component
    edit('apps/web/src/features/projects/services/projects.server.ts', "import 'server-only';\n", "")
    edit('apps/web/src/features/projects/components/project-form.tsx', "import type { Project } from '../services/types';", "import type { Project } from '../services/types';\nimport { listProjects } from '../services/projects.server';")
    edit('apps/web/src/features/projects/components/project-form.tsx', "<form action={submit} noValidate>", "<form action={submit} noValidate data-loader={typeof listProjects}>")
elif n == 7:  # CSP header no longer sent to the browser
    edit('apps/web/src/proxy.ts', "  response.headers.set('content-security-policy', csp);\n", "")
elif n == 8:  # log request headers (Authorization, Cookie) in the request log line
    sabotage_headers()
elif n == 9:  # form hook drops the typed value after a failed submit
    edit('apps/web/src/features/projects/hooks/use-project-form.ts', "      const result = await action(previous, form);\n", "      const result = await action(previous, form);\n      if (mounted.current && result.status !== 'success')\n        update({ ...current.current, value: current.current.baseline, revision: current.current.revision + 1 });\n")
elif n == 10:
    edit('apps/api/src/app.ts', "  app.use(helmet());\n", "")
    edit('apps/api/src/app.ts', "import helmet from 'helmet';\n", "")
else:
    raise SystemExit('unknown sabotage')
print('applied', n)
