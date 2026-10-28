import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Identity, identitySettings } from '../src/lib/identity.ts';
import { testIssuer } from '../tests/oidc-provider.mjs';
test('identity configuration refuses insecure remote origins and incomplete profiles', () => {
  assert.equal(identitySettings({}), undefined);
  assert.throws(() => identitySettings({ AUTH_MODE: 'typo' }));
  const base = {
    AUTH_MODE: 'oidc',
    AUTH_CLIENT_ID: 'test-client',
    AUTH_APP_ORIGIN: 'https://app.example',
    AUTH_ISSUER: 'https://issuer.example',
    AUTH_REDIS_URL: 'rediss://redis.example',
  };
  assert.equal(identitySettings(base).clientId, 'test-client');
  for (const extra of [
    { AUTH_CLIENT_ID: '' },
    { AUTH_APP_ORIGIN: 'http://evil.example' },
    { AUTH_SESSION_SECONDS: 'NaN' },
    { AUTH_SCOPE: 'profile' },
    { AUTH_ISSUER: 'https://issuer.example/.well-known/openid-configuration' },
  ])
    assert.throws(() => identitySettings({ ...base, ...extra }));
});
test('real OIDC code/PKCE, one-time state, concurrent rotating refresh and revoked session', async () => {
  assert.ok(process.env.TEST_REDIS_URL, 'TEST_REDIS_URL must name an isolated Redis instance');
  const issuer = await testIssuer(),
    origin = 'http://127.0.0.1:8099';
  const settings = identitySettings({
    AUTH_MODE: 'oidc',
    AUTH_APP_ORIGIN: origin,
    AUTH_ISSUER: issuer.base,
    AUTH_REDIS_URL: process.env.TEST_REDIS_URL,
    AUTH_NAMESPACE: 'test-' + randomUUID(),
    AUTH_CLIENT_ID: 'test-client',
    AUTH_INSECURE_LOOPBACK: 'true',
  });
  const identity = new Identity(settings),
    second = new Identity(settings);
  try {
    const begin = await identity.begin();
    const authorize = await fetch(begin.url, { redirect: 'manual' });
    const callback = new URL(authorize.headers.get('location'));
    const wrong = new URL(callback);
    wrong.searchParams.set('state', 'wrong');
    await assert.rejects(identity.complete(begin.id, wrong));
    await assert.rejects(identity.complete(begin.id, callback));
    const next = await identity.begin('/projects/some-id?page=2');
    const response = await fetch(next.url, { redirect: 'manual' });
    const url = new URL(response.headers.get('location'));
    const { sessionId: id, returnTo } = await identity.complete(next.id, url);
    assert.equal(returnTo, '/projects/some-id?page=2', 'sign-in returns to the original same-origin page');
    assert.equal(await identity.hasSession(id), true);
    await assert.rejects(identity.complete(next.id, url));
    const tokens = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? identity : second).token(id)));
    assert.ok(tokens.every((token) => token && token === tokens[0]));
    assert.equal(issuer.stats().refreshCount, 1);
    await identity.logout(id);
    assert.equal(await second.token(id), undefined);
    assert.equal(issuer.stats().revocations, 1);
    assert.equal(await identity.token('forged'), undefined);
    issuer.outage(true);
    await assert.rejects(new Identity(settings).begin());
  } finally {
    identity.close();
    second.close();
    await issuer.close();
  }
});
