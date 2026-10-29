import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
test('private project links use one delegated navigator instead of hydrating every list row', () => {
  const projectLink = new URL('../src/features/projects/components/project-link.tsx', import.meta.url);
  assert.equal(existsSync(projectLink), false);
  const page = readFileSync(new URL('../src/app/projects/page.tsx', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../src/app/projects/[id]/page.tsx', import.meta.url), 'utf8');
  const form = readFileSync(new URL('../src/features/projects/components/project-form.tsx', import.meta.url), 'utf8');
  const navigation = readFileSync(
    new URL('../src/features/projects/components/project-navigation.tsx', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(page + detail + form + navigation, /next\/link|ProjectLink|useLinkStatus/);
  assert.equal(page.match(/<ProjectNavigation/g)?.length, 1);
  assert.equal(detail.match(/<ProjectNavigation/g)?.length, 1);
  assert.match(page, /<a data-project-navigation href=\{'\/projects\/' \+ project\.id\}>/);
  assert.match(form, /<a data-project-navigation href=\{'\/projects\/' \+ state\.createdId\}>/);
  assert.match(navigation, /a\[data-project-navigation\]/);
  assert.match(navigation, /router\.push\(target\.pathname \+ target\.search \+ target\.hash\)/);
  assert.match(navigation, /if \(!pending\) return null/);
});
