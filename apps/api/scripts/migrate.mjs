import { Pool } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
// Messages built only from migration file names and SQLSTATE codes, so they are safe to print.
export class MigrationError extends Error {}
const safeCode = (error) =>
  typeof error?.code === 'string' && /^[A-Z0-9_]{1,20}$/.test(error.code) ? error.code : 'UNKNOWN';
export async function runMigrations(connectionString, directory = new URL('../migrations/', import.meta.url)) {
  if (!connectionString) throw new MigrationError('DATABASE_URL is required');
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 2000, statement_timeout: 15000 });
  let client;
  try {
    client = await pool.connect();
  } catch (error) {
    await pool.end();
    throw new MigrationError(
      `Cannot connect to the database (${safeCode(error)}); check DATABASE_URL and database health`,
    );
  }
  try {
    await client.query('SELECT pg_advisory_lock(78234901)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL)');
    for (const name of (await readdir(directory)).filter((x) => /^\d+[-\w]*\.sql$/.test(x)).sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (previous.rows.length) {
        if (previous.rows[0].checksum !== checksum)
          throw new MigrationError(
            `Applied migration was modified: ${name} (checksum mismatch). Never edit an applied migration; add a new one`,
          );
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new MigrationError(`Migration ${name} failed (${safeCode(error)}) and was rolled back`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(78234901)');
    client.release();
    await pool.end();
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await runMigrations(process.env.DATABASE_URL);
    console.info('Migrations applied');
  } catch (error) {
    console.error(error instanceof MigrationError ? error.message : `Migration failed (${safeCode(error)})`);
    process.exitCode = 1;
  }
}
