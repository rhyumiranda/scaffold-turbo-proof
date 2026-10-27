import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const guard = new URL('./test-database.mjs', import.meta.url).pathname;
const run = (env) =>
  spawnSync(process.execPath, ['--import', guard, '-e', ''], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
test('DB-backed suites refuse anything but a disposable *_test database', () => {
  assert.equal(run({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://u@127.0.0.1:5432/reference_test' }).status, 0);
  for (const env of [
    { NODE_ENV: 'test', DATABASE_URL: 'postgresql://u@127.0.0.1:5432/app' },
    { NODE_ENV: 'test', DATABASE_URL: 'postgresql://u@127.0.0.1:5432/production' },
    { NODE_ENV: 'test', DATABASE_URL: 'postgresql://u@127.0.0.1:5432/test_backup' },
    { NODE_ENV: 'production', DATABASE_URL: 'postgresql://u@127.0.0.1:5432/reference_test' },
    { NODE_ENV: 'test' },
  ]) {
    const result = run(env);
    assert.notEqual(result.status, 0, JSON.stringify(env));
    assert.doesNotMatch(result.stderr, /postgresql:\/\/u@/, 'never print the connection string');
  }
});
