import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateBudget } from './check-budget.mjs';
test('budget gate fails a real byte regression and rejects disabled budgets', () => {
  assert.throws(() => evaluateBudget(101, { maxClientJavascriptGzipBytes: 100 }), /exceeds/);
  assert.throws(() => evaluateBudget(1, { maxClientJavascriptGzipBytes: 0 }), /Invalid/);
  assert.equal(evaluateBudget(99, { maxClientJavascriptGzipBytes: 100 }).gzipBytes, 99);
});
test('private project links do not prefetch every detail response during the list-page load', () => {
  const projectLink = new URL('../src/features/projects/components/project-link.tsx', import.meta.url);
  if (!existsSync(projectLink)) return;
  const source = readFileSync(projectLink, 'utf8');
  assert.match(source, /prefetch = false/);
  assert.match(source, /<Link \{\.\.\.props\} prefetch=\{prefetch\}>/);
});
