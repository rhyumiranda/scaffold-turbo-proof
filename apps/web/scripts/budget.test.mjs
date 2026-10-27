import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBudget } from './check-budget.mjs';
test('budget gate fails a real byte regression and rejects disabled budgets', () => {
  assert.throws(() => evaluateBudget(101, { maxClientJavascriptGzipBytes: 100 }), /exceeds/);
  assert.throws(() => evaluateBudget(1, { maxClientJavascriptGzipBytes: 0 }), /Invalid/);
  assert.equal(evaluateBudget(99, { maxClientJavascriptGzipBytes: 100 }).gzipBytes, 99);
});
