import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jsonDepth, MAX_JSON_DEPTH } from '../dist/platform/errors.js';
test('JSON depth is measured without recursion and rejects pathological nesting', () => {
  assert.equal(jsonDepth({ name: 'x' }), 1);
  assert.equal(jsonDepth({ a: { b: [1, { c: 2 }] } }), 4);
  let deep = [];
  for (let i = 0; i < 10000; i++) deep = [deep];
  assert.ok(jsonDepth(deep) > MAX_JSON_DEPTH);
  assert.equal(jsonDepth('scalar'), 0);
});
