import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../tests/integration-bootstrap.mjs';

test('missing disposable database is blocked, never skipped or marked passed', async () => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await assert.rejects(() => run({ webDirectory: process.cwd() }), /disposable DATABASE_URL/);
  } finally {
    if (previous !== undefined) process.env.DATABASE_URL = previous;
  }
});
