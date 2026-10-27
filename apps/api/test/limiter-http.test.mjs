import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../dist/app.js';
test('two real APIs share quota; forged forwarding headers cannot reset it; dependency affects readiness only', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(process.env.TEST_REDIS_URL);
  assert.ok(process.env.DATABASE_URL);
  const previous = { ...process.env };
  Object.assign(process.env, {
    AUTH_ISSUER: 'https://identity.example.invalid',
    AUTH_JWKS_URL: 'https://identity.example.invalid/jwks',
    AUTH_AUDIENCE: 'test',
    LIMITER_MODE: 'redis',
    LIMITER_REDIS_URL: process.env.TEST_REDIS_URL,
    LIMITER_NAMESPACE: 'test-' + randomUUID(),
    RATE_LIMIT: '3',
  });
  const a = await createApp(),
    b = await createApp();
  await a.listen(0, '127.0.0.1');
  await b.listen(0, '127.0.0.1');
  let unavailable;
  try {
    const bases = [await a.getUrl(), await b.getUrl()];
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        fetch(bases[i % 2] + '/v1/projects', { headers: { 'x-forwarded-for': '192.0.2.' + i } }),
      ),
    );
    assert.equal(responses.filter((r) => r.status === 401).length, 3);
    assert.equal(responses.filter((r) => r.status === 429).length, 9);
    assert.equal((await fetch(bases[0] + '/health/live')).status, 200);
    process.env.LIMITER_REDIS_URL = 'redis://127.0.0.1:1';
    unavailable = await createApp();
    await unavailable.listen(0, '127.0.0.1');
    const url = await unavailable.getUrl();
    assert.equal((await fetch(url + '/v1/projects')).status, 503);
    assert.equal((await fetch(url + '/health/ready')).status, 503);
    assert.equal((await fetch(url + '/health/live')).status, 200);
  } finally {
    await a.close();
    await b.close();
    await unavailable?.close();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
