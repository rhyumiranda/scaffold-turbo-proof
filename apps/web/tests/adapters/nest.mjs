import { realpath, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
export async function run({ webDirectory }) {
  if (!process.env.NEST_TEST_PROJECT || !process.env.DATABASE_URL)
    throw new Error('Paired adapter needs NEST_TEST_PROJECT and a disposable DATABASE_URL.');
  const api = await realpath(process.env.NEST_TEST_PROJECT);
  // Same guard as the API's DB-backed suites: never override NODE_ENV, never touch a database not named *_test.
  if (process.env.NODE_ENV !== 'test') throw new Error('Paired integration requires NODE_ENV=test.');
  const database = new URL(process.env.DATABASE_URL);
  if (!/^[A-Za-z0-9_]+_test$/.test(decodeURIComponent(database.pathname.slice(1))))
    throw new Error(
      'Refusing database: the paired integration writes without cleanup, so its name must end with _test.',
    );
  if (!['127.0.0.1', 'localhost', 'postgres'].includes(database.hostname))
    throw new Error(
      'Paired example accepts only loopback or isolated CI postgres service. Write a reviewed adapter for a different test topology.',
    );
  await access(join(api, 'dist/app.js'));
  await access(join(api, 'test/with-web.mjs'));
  const child = spawn(
    process.execPath,
    [
      'test/with-web.mjs',
      webDirectory,
      ...(process.env.TEST_OIDC === 'true' ? ['--config=playwright.identity.config.ts'] : []),
    ],
    { cwd: api, env: { ...process.env }, stdio: 'inherit' },
  );
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, 120000);
  const interrupt = () => child.kill('SIGTERM');
  process.once('SIGTERM', interrupt);
  process.once('SIGINT', interrupt);
  try {
    const [code] = await once(child, 'exit');
    if (timedOut) throw new Error('Integration exceeded 120 seconds. Inspect isolated API logs.');
    return code ?? 1;
  } finally {
    clearTimeout(timeout);
    process.off('SIGTERM', interrupt);
    process.off('SIGINT', interrupt);
  }
}
