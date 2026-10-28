import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeSpan } from '../src/lib/trace-export.ts';
import { operations } from '../src/lib/feature-routes.mjs';
test('export removes framework URLs, credential attributes, resource values, events and error text', () => {
  const span = {
    name: 'GET /callback?code=never-log-this',
    attributes: { 'http.url': 'never-log-this', 'http.response.status_code': 400 },
    resource: { attributes: { secret: 'never-log-this' } },
    events: [{ attributes: { secret: 'never-log-this' } }],
    links: [{ attributes: { secret: 'never-log-this' } }],
    status: { code: 2, message: 'never-log-this' },
    spanContext: () => ({ traceId: '123' }),
  };
  const safe = safeSpan(span, 'web');
  assert.equal(safe.name, 'framework.request');
  assert.equal(safe.attributes['http.response.status_code'], 400);
  assert.equal(safe.spanContext().traceId, '123');
  assert.ok(!JSON.stringify(safe).includes('never-log-this'));
  for (const name of operations) assert.equal(safeSpan({ ...span, name }, 'web').name, name);
});
