import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import pg from 'pg';
import { runMigrations } from '../scripts/migrate.mjs';
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
// Every test works in its own PostgreSQL schema of the disposable _test database, named in DATABASE_URL's
// `schema` parameter, so `prisma migrate deploy` and its `_prisma_migrations` ledger stay isolated per test.
async function isolatedSchema() {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(process.env.DATABASE_URL, 'Dedicated disposable database required');
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  } finally {
    await admin.end();
  }
  const prismaUrl = new URL(process.env.DATABASE_URL);
  prismaUrl.searchParams.set('schema', schema);
  const sqlUrl = new URL(process.env.DATABASE_URL);
  sqlUrl.searchParams.set('options', '-c search_path=' + schema);
  return { schema, prismaUrl: prismaUrl.href, pool: new pg.Pool({ connectionString: sqlUrl.href }) };
}
// A throwaway Prisma project (schema, migrations folder, config) for probe migrations.
async function probeProject() {
  const root = await mkdtemp(join(tmpdir(), 'nest-migration-test-'));
  await writeFile(join(root, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n}\n');
  await mkdir(join(root, 'migrations'));
  const config = join(root, 'prisma.config.mjs');
  await writeFile(
    config,
    `export default { schema: ${JSON.stringify(join(root, 'schema.prisma'))}, migrations: { path: ${JSON.stringify(join(root, 'migrations'))} }, datasource: { url: process.env.DATABASE_URL } };\n`,
  );
  const migration = async (name, sql) => {
    await mkdir(join(root, 'migrations', name), { recursive: true });
    await writeFile(join(root, 'migrations', name, 'migration.sql'), sql);
  };
  return { root, config, migrations: join(root, 'migrations'), migration };
}
const count = async (pool, sql, values) => (await pool.query(sql, values)).rows[0].count;
const applied = (pool) =>
  count(pool, 'SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL');
test('migrations support clean install, upgrade, rollback and immutable applied history', async (t) => {
  const { schema, prismaUrl, pool } = await isolatedSchema();
  const project = await probeProject();
  const run = () => runMigrations(prismaUrl, { config: project.config, migrations: project.migrations });
  const columns = () =>
    count(
      pool,
      "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name='probe'",
      [schema],
    );
  try {
    await project.migration('0001_initial', 'CREATE TABLE probe (id integer PRIMARY KEY);');
    assert.deepEqual(await run(), ['0001_initial']);
    assert.equal(await columns(), 1);
    await project.migration('0002_upgrade', 'ALTER TABLE probe ADD COLUMN label text;');
    assert.deepEqual(await run(), ['0002_upgrade']);
    assert.equal(await columns(), 2);
    assert.deepEqual(await run(), []);
    assert.equal(await applied(pool), 2);
    // Edited history: Prisma's own behaviour is recorded for the docs (not asserted), then the runner must refuse.
    const initial = join(project.migrations, '0001_initial', 'migration.sql');
    await appendFile(initial, '\n-- edited after it was applied\n');
    const raw = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--config', project.config], {
      env: { ...process.env, DATABASE_URL: prismaUrl, CHECKPOINT_DISABLE: '1' },
      encoding: 'utf8',
      timeout: 120000,
    });
    t.diagnostic(
      `bare prisma migrate deploy after an applied migration was edited: exit ${raw.status}; ` +
        `output mentions a modified migration or checksum: ${/modif|checksum/i.test(raw.stdout + raw.stderr)}`,
    );
    await assert.rejects(run(), /Applied migration was modified: 0001_initial .*checksum mismatch/);
    await writeFile(initial, 'CREATE TABLE probe (id integer PRIMARY KEY);');
    assert.deepEqual(await run(), []);
    // A failing migration is rolled back as a whole and never recorded as applied.
    await project.migration('0003_failed', 'BEGIN;\nCREATE TABLE rollback_probe (id integer);\nSELECT 1/0;\nCOMMIT;');
    const failure = await run().then(
      () => assert.fail('a failing migration must fail the run'),
      (error) => error,
    );
    // Synthetic probe data only, so the raw Prisma output is safe to show here.
    t.diagnostic('prisma output for the failing migration: ' + JSON.stringify(failure.details));
    t.diagnostic(
      'ledger after the failure: ' +
        JSON.stringify(
          (
            await pool.query(
              'SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count FROM _prisma_migrations ORDER BY 1',
            )
          ).rows,
        ),
    );
    assert.match(failure.message, /Migration 0003_failed failed.*rolled back/);
    assert.equal(
      await count(pool, "SELECT count(*)::int AS count FROM pg_tables WHERE tablename = 'rollback_probe'"),
      0,
    );
    assert.equal(await applied(pool), 2);
  } finally {
    await pool.end();
  }
  // Test schema retained only in the disposable cluster; no destructive teardown.
});
test('two migration runs started together leave one schema and one ledger', async () => {
  const { prismaUrl, pool } = await isolatedSchema();
  const project = await probeProject();
  await project.migration('0001_first', 'CREATE TABLE one (id integer PRIMARY KEY);');
  await project.migration('0002_second', 'CREATE TABLE two (id integer PRIMARY KEY);');
  const run = () => runMigrations(prismaUrl, { config: project.config, migrations: project.migrations });
  try {
    const results = await Promise.allSettled([run(), run()]);
    // Both succeed (the second waits for the advisory lock), or one is refused with a lock message.
    assert.ok(results.some((result) => result.status === 'fulfilled'));
    for (const result of results) if (result.status === 'rejected') assert.match(result.reason.message, /lock/);
    assert.equal(await applied(pool), 2);
    assert.equal(await count(pool, 'SELECT count(*)::int AS count FROM _prisma_migrations'), 2);
  } finally {
    await pool.end();
  }
});
test('database constraints reject rule-breaking writes even when the application is bypassed', async () => {
  const { schema, prismaUrl, pool } = await isolatedSchema();
  // The real application migrations, applied into an isolated schema.
  await runMigrations(prismaUrl);
  const insert = (values) =>
    pool.query('INSERT INTO projects(id, owner_id, name, version) VALUES ($1, $2, $3, $4)', values);
  const rejects = (values, code, rule) =>
    assert.rejects(insert(values), (error) => error.code === code, `${rule} must be enforced by the database`);
  try {
    const id = randomUUID();
    await insert([id, 'owner', 'Valid', 1]);
    await rejects([id, 'owner', 'Duplicate id', 1], '23505', 'primary key');
    await rejects([randomUUID(), null, 'No owner', 1], '23502', 'owner not null');
    await rejects([randomUUID(), 'owner', null, 1], '23502', 'name not null');
    await rejects([randomUUID(), '', 'Empty owner', 1], '23514', 'owner length');
    await rejects([randomUUID(), 'owner', '', 1], '23514', 'name minimum length');
    await rejects([randomUUID(), 'owner', 'x'.repeat(101), 1], '23514', 'name maximum length');
    await rejects([randomUUID(), 'owner', ' padded ', 1], '23514', 'name trimmed');
    await rejects([randomUUID(), 'owner', 'Zero version', 0], '23514', 'version positive');
    const index = await pool.query(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = $1 AND indexname = 'projects_owner_order'",
      [schema],
    );
    assert.match(index.rows[0]?.indexdef ?? '', /\(owner_id, created_at DESC, id DESC\)/);
    // Modules reference each other by plain IDs: the migrated schema holds no foreign keys at all.
    const foreignKeys = await count(
      pool,
      "SELECT count(*)::int AS count FROM pg_constraint WHERE contype = 'f' AND connamespace = $1::regnamespace",
      [schema],
    );
    assert.equal(foreignKeys, 0);
  } finally {
    await pool.end();
  }
});
test('the committed migrations produce exactly the Prisma schema (no drift)', async () => {
  const { prismaUrl, pool } = await isolatedSchema();
  await pool.end();
  await runMigrations(prismaUrl);
  const diff = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema', '--exit-code'],
    {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, DATABASE_URL: prismaUrl, CHECKPOINT_DISABLE: '1' },
      encoding: 'utf8',
      timeout: 120000,
    },
  );
  // --exit-code: 0 = no difference, 2 = the schema files and the migrations disagree, 1 = error.
  assert.equal(diff.status, 0, 'prisma/schema and prisma/migrations disagree; add a migration:\n' + diff.stdout);
});
