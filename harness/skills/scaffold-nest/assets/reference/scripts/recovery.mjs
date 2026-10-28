import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import pg from 'pg';
import { runMigrations } from './migrate.mjs';
// Read-only source backup (schema, data and the `_prisma_migrations` history), restored in one transaction into a
// NEW owned cluster; then `prisma migrate deploy` must find nothing pending and no edited history.
if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL || !process.env.PG_BIN)
  throw new Error('NODE_ENV=test, dedicated DATABASE_URL and PG_BIN required');
const source = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(source.hostname))
  throw new Error('Recovery exercise only accepts a disposable loopback source');
if (!source.port || !source.username || source.pathname === '/')
  throw new Error('Recovery source requires explicit port, user and database');
const tables = (process.env.RECOVERY_TABLES ?? 'projects').split(',');
if (!tables.length || tables.some((t) => !/^\w+$/.test(t))) throw new Error('Invalid RECOVERY_TABLES');
const root = await mkdtemp(join(tmpdir(), 'scaffold-restore-')),
  data = join(root, 'postgres');
function command(name, args, env = process.env) {
  const result = spawnSync(join(process.env.PG_BIN, name), args, {
    // Fixed locale and time zone: initdb/pg_ctl refuse an unset locale, and the comparison must not depend on the host.
    env: { ...env, LC_ALL: 'C', LANG: 'C', TZ: 'UTC' },
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    // Tool output can contain connection details, so only a known, value-free cause is named.
    if (/server version mismatch/.test(result.stderr ?? ''))
      throw new Error(
        `Recovery tool failed: ${name} major version differs from the server; set PG_BIN to client tools of the server's major version`,
      );
    throw new Error('Recovery tool failed: ' + name + ' (details omitted)');
  }
  return result.stdout;
}
let started = false;
const began = Date.now();
try {
  const dumpEnv = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('PG'))),
    PGHOST: source.hostname,
    PGHOSTADDR: '127.0.0.1',
    PGPORT: source.port,
    PGUSER: decodeURIComponent(source.username),
    PGPASSWORD: decodeURIComponent(source.password),
    PGDATABASE: decodeURIComponent(source.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '2',
  };
  // One logical dump of the public schema, including the migration history table and its rows.
  const dump = command('pg_dump', ['--inserts', '--no-owner', '--no-privileges', '--schema=public'], dumpEnv);
  // pg_dump's psql-only guards are unnecessary when the script runs through the parameter-free pg driver.
  const sql = dump
    .split('\n')
    .filter((line) => !/^\\(?:un)?restrict\b/.test(line) && !/^CREATE SCHEMA public;/.test(line))
    .join('\n');
  await writeFile(join(root, 'restore.sql'), sql, { mode: 0o600 });
  command('initdb', ['-D', data, '-U', 'restore_check', '--encoding=UTF8', '--locale=C', '--auth=trust']);
  const socket = createServer();
  await new Promise((r) => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  command('pg_ctl', [
    '-D',
    data,
    '-l',
    join(root, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${port} -k ${root} -c timezone=UTC`,
    '-w',
    'start',
  ]);
  started = true;
  const target = `postgresql://restore_check@127.0.0.1:${port}/postgres`;
  const restore = new pg.Client({ connectionString: target, statement_timeout: 15000 });
  await restore.connect();
  try {
    await restore.query('BEGIN');
    await restore.query(sql);
    await restore.query('COMMIT');
  } catch (error) {
    await restore.query('ROLLBACK').catch(() => {});
    throw new Error(`Restore script failed (${/^[0-9A-Z]{5}$/.test(error.code ?? '') ? error.code : 'UNKNOWN'})`);
  } finally {
    await restore.end();
  }
  // The restored history must match the committed migrations, with nothing left to apply.
  const pending = await runMigrations(target);
  if (pending.length) throw new Error('Restored history is behind the committed migrations: ' + pending.join(', '));
  // Both sides render timestamps in UTC, so equal data hashes equal regardless of each server's TimeZone setting.
  const utc = { statement_timeout: 10000, options: '-c TimeZone=UTC' };
  const before = new pg.Pool({ connectionString: process.env.DATABASE_URL, ...utc }),
    after = new pg.Pool({ connectionString: target, ...utc });
  try {
    for (const table of tables) {
      const query = `SELECT count(*)::text AS count,md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS digest FROM "${table}" t`;
      if (JSON.stringify((await before.query(query)).rows) !== JSON.stringify((await after.query(query)).rows))
        throw new Error('Restored data differs: ' + table);
    }
  } finally {
    await before.end();
    await after.end();
  }
  console.log(
    JSON.stringify({
      passed: true,
      tables,
      elapsedMs: Date.now() - began,
      artifact: root,
      scope:
        'Disposable logical restore checked by prisma migrate deploy; not production RPO/RTO or mixed-version release proof',
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (started) command('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
}
