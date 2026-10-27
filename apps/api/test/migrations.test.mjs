import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from '../scripts/migrate.mjs';
test('migrations support clean install, upgrade, rollback and immutable applied history', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(process.env.DATABASE_URL, 'Dedicated disposable database required');
  const root = await mkdtemp(join(tmpdir(), 'nest-migration-test-'));
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  const prepare = join(root, 'prepare');
  await mkdir(prepare);
  await writeFile(join(prepare, '900-' + schema + '.sql'), `CREATE SCHEMA ${schema};`);
  // Even test isolation schema creation goes through the migration runner.
  await runMigrations(process.env.DATABASE_URL, pathToFileURL(prepare + '/'));
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('options', '-c search_path=' + schema);
  const migrations = join(root, 'migrations');
  await mkdir(migrations);
  const directory = pathToFileURL(migrations + '/');
  await writeFile(join(migrations, '001-initial.sql'), 'CREATE TABLE probe (id integer PRIMARY KEY);');
  const pool = new Pool({ connectionString: url.href });
  try {
    await runMigrations(url.href, directory);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name='probe'",
          [schema],
        )
      ).rows[0].count,
      1,
    );
    await writeFile(join(migrations, '002-upgrade.sql'), 'ALTER TABLE probe ADD COLUMN label text;');
    await runMigrations(url.href, directory);
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema=$1 AND table_name='probe'",
          [schema],
        )
      ).rows[0].count,
      2,
    );
    await runMigrations(url.href, directory);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count, 2);
    await writeFile(join(migrations, '003-failed.sql'), 'CREATE TABLE rollback_probe (id integer); SELECT 1/0;');
    await assert.rejects(runMigrations(url.href, directory));
    assert.equal((await pool.query("SELECT to_regclass('rollback_probe') AS name")).rows[0].name, null);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count, 2);
    await writeFile(join(migrations, '001-initial.sql'), 'CREATE TABLE probe (id bigint PRIMARY KEY);');
    await assert.rejects(runMigrations(url.href, directory), /Applied migration was modified/);
  } finally {
    await pool.end();
  }
  // Test schema retained only in the disposable cluster; no destructive teardown.
});
test('database constraints reject rule-breaking writes even when the application is bypassed', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  const root = await mkdtemp(join(tmpdir(), 'nest-constraint-test-'));
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  await writeFile(join(root, '900-' + schema + '.sql'), `CREATE SCHEMA ${schema};`);
  await runMigrations(process.env.DATABASE_URL, pathToFileURL(root + '/'));
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('options', '-c search_path=' + schema);
  // The real application migrations, applied into an isolated schema.
  await runMigrations(url.href, new URL('../migrations/', import.meta.url));
  const pool = new Pool({ connectionString: url.href });
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
  } finally {
    await pool.end();
  }
});
