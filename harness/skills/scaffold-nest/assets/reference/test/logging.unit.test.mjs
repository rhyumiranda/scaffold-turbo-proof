import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProblemFilter } from '../dist/platform/errors.js';
test('unexpected failures retain safe diagnostic category, never raw secret text', () => {
  const logs = [],
    previous = console.info;
  let body;
  console.info = (value) => logs.push(value);
  const response = {
    getHeader: () => '12345678-1234-4234-8234-123456789012',
    status: () => response,
    type: () => response,
    json: (value) => {
      body = value;
    },
  };
  try {
    new ProblemFilter().catch(Object.assign(new Error('password=never-log-this'), { code: '23505' }), {
      switchToHttp: () => ({ getResponse: () => response }),
    });
  } finally {
    console.info = previous;
  }
  assert.equal(body.status, 500);
  assert.equal(JSON.parse(logs[0]).errorType, '23505');
  assert.ok(!JSON.stringify([body, logs]).includes('never-log-this'));
});
