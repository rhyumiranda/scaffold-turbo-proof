import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LimitStorage } from '../dist/platform/limiter.js';
test('two independent limiter instances share one atomic budget and expire blocks', async () => {
  assert.ok(process.env.TEST_REDIS_URL, 'Isolated TEST_REDIS_URL required');
  const config = {
    limiterMode: 'redis',
    redisUrl: process.env.TEST_REDIS_URL,
    limiterNamespace: 'test-' + randomUUID(),
  };
  const a = new LimitStorage(config),
    b = new LimitStorage(config);
  try {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).increment('same-actor', 100, 3, 100, 'default')),
    );
    assert.equal(results.filter((r) => !r.isBlocked).length, 3);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await b.increment('same-actor', 100, 3, 100, 'default')).isBlocked, false);
  } finally {
    a.onApplicationShutdown();
    b.onApplicationShutdown();
  }
});
test('shared limiter failure is unavailable, never silently unlimited', async () => {
  const limiter = new LimitStorage({ limiterMode: 'redis', redisUrl: 'redis://127.0.0.1:1', limiterNamespace: 'test' });
  try {
    await assert.rejects(limiter.increment('key', 100, 2, 100, 'default'), (error) => error.getStatus() === 503);
  } finally {
    limiter.onApplicationShutdown();
  }
});
