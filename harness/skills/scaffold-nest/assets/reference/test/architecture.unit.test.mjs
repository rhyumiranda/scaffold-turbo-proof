import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkArchitecture } from '../scripts/check-architecture.mjs';
test('architecture accepts public feature entrypoints', () => {
  assert.deepEqual(
    checkArchitecture({ 'a/service.ts': "import {b} from '../b/index.js';", 'b/index.ts': 'export const b=1;' }),
    [],
  );
});
test('architecture rejects private, inverted, computed and cyclic imports', () => {
  assert.ok(
    checkArchitecture({ 'a/service.ts': "import '../b/service.js';", 'b/service.ts': '' }).some((x) =>
      x.includes('public index'),
    ),
  );
  assert.ok(
    checkArchitecture({ 'platform/service.ts': "import '../a/index.js';", 'a/index.ts': '' }).some((x) =>
      x.includes('cannot depend'),
    ),
  );
  assert.ok(
    checkArchitecture({ 'a/index.ts': "import './service.js';", 'a/service.ts': "import './index.js';" }).some((x) =>
      x.includes('cycle'),
    ),
  );
  assert.ok(checkArchitecture({ 'a/index.ts': 'import(variable);' }).some((x) => x.includes('computed')));
  assert.ok(checkArchitecture({ 'a/index.ts': "import pg from 'pg';" }).some((x) => x.includes('belong to platform')));
});
// Module data ownership: each module owns the models in prisma/schema/<module>/ and nothing else.
const base = 'datasource db {\n  provider = "postgresql"\n  relationMode = "prisma"\n}\n';
const schema = {
  'base.prisma': base,
  'a/a.prisma': 'model Alpha {\n  id String @id\n  betaId String\n}\n',
  'b/b.prisma': 'model Beta {\n  id String @id\n}\n',
};
const owned = { 'a/repository.ts': 'export const f = (db) => db.client.alpha.findMany({});', 'b/index.ts': '' };
test('architecture accepts a module that uses only its own models', () => {
  assert.deepEqual(checkArchitecture(owned, { schema, migrations: {} }), []);
});
test("architecture rejects a module that queries another module's model", () => {
  for (const source of [
    'export const f = (db) => db.client.beta.findMany({});',
    "export const f = (db) => db.client['beta'].update({});",
    'export const f = (tx) => tx.beta.count();',
  ])
    assert.ok(
      checkArchitecture({ ...owned, 'a/service.ts': source }, { schema, migrations: {} }).some((x) =>
        x.includes('a/service.ts: a may only use its own models; Beta belongs to module b'),
      ),
      source,
    );
  // Platform and top-level code do not own feature models either.
  assert.ok(
    checkArchitecture({ ...owned, 'app.ts': 'db.client.alpha.findFirst({});' }, { schema, migrations: {} }).some((x) =>
      x.includes('Alpha belongs to module a'),
    ),
  );
});
test('architecture keeps raw SQL, the generated client and repositories inside their owners', () => {
  const check = (files) => checkArchitecture({ ...owned, ...files }, { schema, migrations: {} });
  assert.deepEqual(
    check({
      'a/repository.ts':
        'export const f = (db, id) => db.client.$queryRaw`UPDATE "Alpha" SET "id" = ${id} WHERE "id" = ${id} RETURNING "id"`;',
    }),
    [],
  );
  assert.ok(
    check({
      'a/repository.ts': 'export const f = (db) => db.client.$queryRaw`UPDATE "Beta" SET "id" = "id"`;',
    }).some((x) => x.includes('mapped tables')),
  );
  assert.ok(check({ 'a/x.ts': 'db.client.$queryRaw`SELECT * FROM "Alpha"`;' }).some((x) => x.includes('raw SQL')));
  assert.ok(check({ 'a/x.ts': 'db.client.$queryRawUnsafe("SELECT 1");' }).some((x) => x.includes('raw SQL')));
  assert.ok(
    check({ 'a/x.ts': "import { PrismaClient } from '../generated/prisma/client.js';" }).some((x) =>
      x.includes('generated Prisma client'),
    ),
  );
  assert.ok(
    check({ 'a/x.ts': "import { PrismaClient } from '@prisma/client';" }).some((x) => x.includes('belong to platform')),
  );
  assert.deepEqual(
    check({ 'platform/database.ts': "import { PrismaClient } from '../generated/prisma/client.js';" }),
    [],
  );
  assert.ok(
    check({ 'a/index.ts': "export { R } from './repository.js';" }).some((x) => x.includes('repository stays private')),
  );
  assert.ok(check({ 'b/x.ts': "import '../a/repository.js';" }).some((x) => x.includes('public index')));
});
test('schema rules: no foreign keys, no cross-module relations, indexed relation fields, models in modules', () => {
  const run = (overrides, migrations = {}) =>
    checkArchitecture(owned, { schema: { ...schema, ...overrides }, migrations });
  assert.ok(
    run(
      {},
      {
        '0002_x/migration.sql':
          'BEGIN;\nALTER TABLE "alpha" ADD CONSTRAINT f FOREIGN KEY ("betaId") REFERENCES "beta"("id");\nCOMMIT;',
      },
    ).some((x) => x.includes('foreign keys are not allowed')),
  );
  assert.ok(
    run({}, { '0002_x/migration.sql': 'BEGIN;\nCREATE TABLE t (b uuid references beta);\nCOMMIT;' }).some((x) =>
      x.includes('foreign keys'),
    ),
  );
  assert.deepEqual(
    run(
      {},
      {
        '0002_x/migration.sql': '-- no REFERENCES here\nBEGIN;\nCREATE TABLE t (id int);\nCOMMIT;\n-- trailing note\n',
      },
    ),
    [],
  );
  assert.ok(
    run({
      'a/a.prisma':
        'model Alpha {\n  id String @id\n  betaId String\n  beta Beta @relation(fields: [betaId], references: [id])\n}\n',
    }).some((x) => x.includes('Alpha.beta is a relation to Beta owned by module b')),
  );
  const parent = 'model Parent {\n  id String @id\n  kids Kid[]\n}\n';
  const kid = (extra) =>
    `model Kid {\n  id String @id\n  parentId String\n  parent Parent @relation(fields: [parentId], references: [id])\n${extra}}\n`;
  assert.ok(
    run({ 'a/a.prisma': parent + kid('') }).some((x) =>
      x.includes('Kid.parent needs an index starting with [parentId]'),
    ),
  );
  assert.deepEqual(run({ 'a/a.prisma': parent + kid('  @@index([parentId])\n') }), []);
  assert.ok(
    run({ 'base.prisma': base.replace('  relationMode = "prisma"\n', '') }).some((x) => x.includes('relationMode')),
  );
  assert.ok(
    run({ 'base.prisma': base + 'model Loose {\n  id String @id\n}\n' }).some((x) => x.includes('not the shared base')),
  );
  assert.ok(run({ 'c/c.prisma': 'model Gamma {\n  id String @id\n}\n' }).some((x) => x.includes('no src/c/ module')));
});
test('schema rules: every migration runs in one transaction', () => {
  const run = (sql) => checkArchitecture(owned, { schema, migrations: { '0002_x/migration.sql': sql } });
  assert.ok(run('CREATE TABLE t (id int);').some((x) => x.includes('wrap the migration in BEGIN')));
  assert.ok(run('BEGIN;\nCREATE TABLE t (id int);').some((x) => x.includes('wrap the migration in BEGIN')));
  assert.deepEqual(run('begin;\nCREATE TABLE t (id int);\ncommit;'), []);
});
