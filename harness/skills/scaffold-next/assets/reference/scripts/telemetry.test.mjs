import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeRequestRecord } from '../src/lib/telemetry.ts';
import { operations } from '../src/lib/feature-routes.mjs';
test('structured request record cannot include credentials, raw payloads, URLs or arbitrary exception text', () => {
  const record = safeRequestRecord({
    requestId: 'd45a14ba-6bc7-4116-b6c4-93834fa24e18',
    operation: operations[0],
    status: 503,
    durationMs: 12.4,
    outcome: 'transport_error',
    authorization: 'secret-token',
    body: { name: 'private' },
    error: 'provider leaked secret',
  });
  assert.deepEqual(Object.keys(record), [
    'time',
    'level',
    'service',
    'event',
    'requestId',
    'operation',
    'status',
    'durationMs',
    'outcome',
  ]);
  assert.equal(record.level, 'error');
  assert.equal(record.service, 'web');
  assert.equal(record.durationMs, 12);
  assert.doesNotMatch(JSON.stringify(record), /secret|private|provider/);
});
test('log fields reject untrusted free text and invalid numbers', () => {
  const record = safeRequestRecord({
    requestId: 'attacker\nsecret',
    traceId: 'secret',
    operation: 'secret',
    status: NaN,
    durationMs: Infinity,
    outcome: 'secret',
  });
  assert.equal(record.requestId, 'invalid');
  assert.equal(record.operation, 'unknown');
  assert.equal(record.status, 503);
  assert.equal(record.durationMs, 0);
  assert.doesNotMatch(JSON.stringify(record), /secret/);
});
