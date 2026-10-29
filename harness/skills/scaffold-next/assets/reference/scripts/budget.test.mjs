import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentClientFiles, evaluateBudget } from './check-budget.mjs';
test('budget gate fails a real byte regression and rejects disabled budgets', () => {
  assert.throws(() => evaluateBudget(101, { maxClientJavascriptGzipBytes: 100 }), /exceeds/);
  assert.throws(() => evaluateBudget(1, { maxClientJavascriptGzipBytes: 0 }), /Invalid/);
  assert.equal(evaluateBudget(99, { maxClientJavascriptGzipBytes: 100 }).gzipBytes, 99);
});
test('budget gate measures current manifests and ignores stale chunks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'web-budget-'));
  try {
    mkdirSync(join(directory, 'server/app/projects'), { recursive: true });
    mkdirSync(join(directory, 'static/chunks/app/projects/[id]'), { recursive: true });
    writeFileSync(join(directory, 'build-manifest.json'), JSON.stringify({ rootMainFiles: ['static/chunks/main.js'] }));
    writeFileSync(
      join(directory, 'server/app/projects/page_client-reference-manifest.js'),
      'globalThis.m={"chunks":["static/chunks/app/projects/%5Bid%5D/page.js"]}',
    );
    writeFileSync(join(directory, 'static/chunks/main.js'), 'main');
    writeFileSync(join(directory, 'static/chunks/app/projects/[id]/page.js'), 'page');
    writeFileSync(join(directory, 'static/chunks/stale.js'), 'stale');
    assert.deepEqual(currentClientFiles(directory), [
      'static/chunks/app/projects/[id]/page.js',
      'static/chunks/main.js',
    ]);
  } finally {
    await rm(directory, { recursive: true });
  }
});
