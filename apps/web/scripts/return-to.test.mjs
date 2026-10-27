import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnTo } from '../src/lib/identity.ts';
import { homePath } from '../src/lib/feature-routes.mjs';
const origin = 'https://app.example';
test('sign-in returns only to same-origin paths', () => {
  assert.equal(safeReturnTo('/any/1?page=2', origin), '/any/1?page=2');
  for (const hostile of [
    'https://evil.example/',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'evil.example',
    '/auth/logout',
    '',
    null,
    '/' + 'x'.repeat(600),
  ])
    assert.equal(safeReturnTo(hostile, origin), homePath, String(hostile));
});
