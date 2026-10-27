import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdentityThrottlerGuard } from '../dist/platform/throttle.js';
const tracker = (request) => IdentityThrottlerGuard.prototype.getTracker.call({}, request);
test('quotas follow the verified user, not a shared IP; raw subjects never reach the store', async () => {
  const alice = await tracker({ ip: '203.0.113.7', identity: { subject: 'alice' } });
  const bob = await tracker({ ip: '203.0.113.7', identity: { subject: 'bob' } });
  assert.notEqual(alice, bob, 'two users behind one NAT get separate quotas');
  assert.equal(alice, await tracker({ ip: '198.51.100.1', identity: { subject: 'alice' } }), 'one user, one quota');
  assert.doesNotMatch(alice, /alice/);
  assert.equal(await tracker({ ip: '203.0.113.7' }), 'ip:203.0.113.7', 'unauthenticated attempts count per IP');
});
