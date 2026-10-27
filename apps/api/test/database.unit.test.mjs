import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientDatabaseError } from '../dist/platform/database.js';
test('database outages and timeouts are transient (503); integrity errors are not', () => {
  for (const code of ['ECONNREFUSED', 'ECONNRESET', '57P01', '57014', '53300', '08006'])
    assert.equal(isTransientDatabaseError(Object.assign(new Error('x'), { code })), true, code);
  assert.equal(isTransientDatabaseError(new Error('timeout exceeded when trying to connect')), true);
  assert.equal(isTransientDatabaseError(new Error('Connection terminated unexpectedly')), true);
  for (const code of ['23505', '23514', '23502', '22P02', '42P01'])
    assert.equal(isTransientDatabaseError(Object.assign(new Error('x'), { code })), false, code);
  assert.equal(isTransientDatabaseError(new Error('application bug')), false);
});
