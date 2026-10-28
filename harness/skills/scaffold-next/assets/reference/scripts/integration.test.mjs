import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../tests/integration-bootstrap.mjs';
test('missing isolated API is blocked, never skipped or marked passed', async () => {
  const old = process.env.NEST_TEST_PROJECT;
  delete process.env.NEST_TEST_PROJECT;
  try {
    await assert.rejects(() => run({ webDirectory: process.cwd() }), /BLOCKED: isolated API bootstrap not configured/);
  } finally {
    if (old !== undefined) process.env.NEST_TEST_PROJECT = old;
  }
});
