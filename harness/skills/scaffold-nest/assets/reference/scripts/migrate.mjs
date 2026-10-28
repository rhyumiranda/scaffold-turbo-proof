// The only way schema changes reach a database: `prisma migrate deploy`, wrapped with two guards.
// 1. Edited history: before deploying, every migration already recorded in `_prisma_migrations` must still match
//    its committed migration.sql (sha256). `prisma migrate deploy` itself does not refuse an edited, already-applied
//    migration, so this check fails loudly instead of letting environments drift apart silently.
// 2. Safe output: Prisma's raw output can contain database messages with row values, so only migration names,
//    Prisma error codes (Pnnnn) and SQLSTATE codes are printed.
// Concurrent runs are safe: `prisma migrate deploy` holds a PostgreSQL advisory lock while it applies migrations.
import pg from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

// `details` keeps Prisma's raw output for tests and debugging; the CLI below never prints it.
export class MigrationError extends Error {
  constructor(message, details = '') {
    super(message);
    this.details = details;
  }
}
const root = fileURLToPath(new URL('..', import.meta.url));
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const safeCode = (error) =>
  typeof error?.code === 'string' && /^[A-Z0-9_]{1,20}$/.test(error.code) ? error.code : 'UNKNOWN';
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// The migrate image ships the config as prisma.config.mjs (no TypeScript in images); the repository has the .ts.
export function defaultConfig(directory = root) {
  const mjs = join(directory, 'prisma.config.mjs');
  return existsSync(mjs) ? mjs : join(directory, 'prisma.config.ts');
}

// Prisma reads `?schema=` from DATABASE_URL; node-postgres does not, so it is split off here.
export function ledgerTarget(connectionString) {
  const url = new URL(connectionString);
  const schema = url.searchParams.get('schema') ?? 'public';
  url.searchParams.delete('schema');
  return { connectionString: url.href, schema };
}

async function localMigrations(directory) {
  const names = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const migrations = new Map();
  for (const name of names) {
    const file = join(directory, name, 'migration.sql');
    if (existsSync(file)) migrations.set(name, await readFile(file, 'utf8'));
  }
  return migrations;
}

// Prisma stores sha256(migration.sql). Line endings are normalised the same way Prisma tolerates them, so a
// checkout with CRLF endings is not reported as an edit.
function sameChecksum(sql, checksum) {
  return [sql, sql.replaceAll('\r\n', '\n'), sql.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')].some(
    (variant) => sha256(variant) === checksum,
  );
}

export async function verifyAppliedMigrations(connectionString, migrationsDirectory) {
  const target = ledgerTarget(connectionString);
  const local = await localMigrations(migrationsDirectory);
  const pool = new pg.Pool({
    connectionString: target.connectionString,
    max: 1,
    connectionTimeoutMillis: 2000,
    statement_timeout: 15000,
  });
  pool.on('error', () => {});
  try {
    let rows;
    try {
      const ledger = await pool.query('SELECT to_regclass(format($1::text, $2::text))::text AS name', [
        '%I._prisma_migrations',
        target.schema,
      ]);
      if (!ledger.rows[0].name) return;
      rows = (
        await pool.query(
          `SELECT migration_name, checksum FROM ${ledger.rows[0].name} WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`,
        )
      ).rows;
    } catch (error) {
      throw new MigrationError(
        `Cannot connect to the database (${safeCode(error)}); check DATABASE_URL and database health`,
      );
    }
    for (const { migration_name: name, checksum } of rows) {
      const sql = local.get(name);
      if (sql !== undefined && !sameChecksum(sql, checksum))
        throw new MigrationError(
          `Applied migration was modified: ${name} (prisma/migrations/${name}/migration.sql, checksum mismatch). ` +
            'Never edit an applied migration; add a new one',
        );
    }
  } finally {
    await pool.end();
  }
}

function prisma(args, env, timeout = 300000) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [prismaCli, ...args], {
      cwd: root,
      env: { ...env, CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code: signal ? 1 : code, output });
    });
  });
}

// ignoreScripts keeps @prisma/engines' postinstall from fetching the schema engine binary. `prisma --version`
// is Prisma's own explicit, checksum-verified fetch; images set PRISMA_SCHEMA_ENGINE_BINARY and skip it.
export async function ensureSchemaEngine(env = process.env) {
  if (env.PRISMA_SCHEMA_ENGINE_BINARY) return;
  const result = await prisma(['--version'], env);
  if (result.code !== 0 || !/Schema Engine\s*:\s*schema-engine-cli/.test(result.output))
    throw new MigrationError('Prisma schema engine is not available; check network access to binaries.prisma.sh');
}

function deployFailure(output) {
  const codes = [...new Set(output.match(/\bP\d{4}\b/g) ?? [])];
  const sqlstate = output.match(/Database error code: ([0-9A-Z]{5})/)?.[1];
  const migration = (output.match(/Migration name: ([\w-]+)/) ?? output.match(/Applying migration `([\w-]+)`/))?.[1];
  if (/advisory lock/i.test(output) || codes.includes('P1002'))
    return 'Another migration run holds the migration lock (timed out waiting for it); retry after it finishes';
  if (codes.includes('P1001') || /Can't reach database server/.test(output))
    return 'Cannot connect to the database (P1001); check DATABASE_URL and database health';
  if (codes.includes('P3009'))
    return 'A previous migration failed (P3009). Fix the cause, then record it with `prisma migrate resolve --rolled-back <name>` and deploy again';
  // A migration wrapped in BEGIN/COMMIT reports only "current transaction is aborted" (25P02): the statement's own
  // error is not in Prisma's output, so the message says where to look instead of guessing.
  const aborted = /current transaction is aborted/.test(output);
  const parts = [...codes, ...(sqlstate ? [`SQLSTATE ${sqlstate}`] : [])].join(', ');
  if (migration)
    return (
      `Migration ${migration} failed${parts ? ` (${parts})` : ''}; its transaction was rolled back and Prisma recorded it ` +
      `as failed.${aborted ? ' Run its SQL on a disposable copy of the database to see the failing statement.' : ''} ` +
      'Fix it with `prisma migrate resolve --rolled-back <name>` and a corrected migration'
    );
  return `prisma migrate deploy failed (${parts || 'unknown error'})`;
}

export async function runMigrations(
  connectionString,
  { config = defaultConfig(), migrations = join(root, 'prisma', 'migrations'), env = process.env, log = () => {} } = {},
) {
  if (!connectionString) throw new MigrationError('DATABASE_URL is required');
  try {
    new URL(connectionString);
  } catch {
    throw new MigrationError('DATABASE_URL is not a valid URL');
  }
  await verifyAppliedMigrations(connectionString, migrations);
  await ensureSchemaEngine(env);
  const result = await prisma(['migrate', 'deploy', '--config', config], { ...env, DATABASE_URL: connectionString });
  if (result.code !== 0) throw new MigrationError(deployFailure(result.output), result.output);
  const applied = result.output.includes('No pending migrations to apply.')
    ? []
    : [...(await localMigrations(migrations)).keys()].filter((name) => result.output.includes(name));
  log(applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations');
  return applied;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runMigrations(process.env.DATABASE_URL, { log: (line) => console.info(line) });
    console.info('Migrations applied');
  } catch (error) {
    console.error(error instanceof MigrationError ? error.message : `Migration failed (${safeCode(error)})`);
    process.exitCode = 1;
  }
}
