import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@redis/client';
import { Identity, identitySettings, SignInError, signInRecord } from '../src/lib/identity.ts';
import { openTransaction, sealPayload, sealTransaction, transactionKey } from '../src/lib/transaction-cookie.mjs';
import { testIssuer } from '../tests/oidc-provider.mjs';
const secret = () => randomBytes(32).toString('base64url');
test('identity configuration refuses insecure remote origins and incomplete profiles', () => {
  assert.equal(identitySettings({}), undefined);
  assert.throws(() => identitySettings({ AUTH_MODE: 'typo' }));
  const base = {
    AUTH_MODE: 'oidc',
    AUTH_CLIENT_ID: 'test-client',
    AUTH_APP_ORIGIN: 'https://app.example',
    AUTH_ISSUER: 'https://issuer.example',
    AUTH_REDIS_URL: 'rediss://redis.example',
    AUTH_TRANSACTION_SECRET: secret(),
  };
  assert.equal(identitySettings(base).clientId, 'test-client');
  for (const extra of [
    { AUTH_CLIENT_ID: '' },
    { AUTH_APP_ORIGIN: 'http://evil.example' },
    { AUTH_SESSION_SECONDS: 'NaN' },
    { AUTH_SCOPE: 'profile' },
    { AUTH_ISSUER: 'https://issuer.example/.well-known/openid-configuration' },
    { AUTH_TRANSACTION_SECRET: '' },
  ])
    assert.throws(() => identitySettings({ ...base, ...extra }));
});
// Rejections must carry the expected reason and a log record free of every secret value involved.
async function rejects(promise, reason, forbidden, providerError) {
  let caught;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof SignInError, `expected SignInError ${reason}, got ${caught}`);
  assert.equal(caught.reason, reason);
  if (providerError) assert.equal(caught.providerError, providerError);
  const line = JSON.stringify(signInRecord('identity.callback.rejected', caught, randomUUID()));
  assert.equal(JSON.parse(line).event, 'identity.callback.rejected');
  assert.equal(JSON.parse(line).reason, reason);
  for (const value of forbidden.filter(Boolean))
    assert.ok(!line.includes(value), 'log line contains a forbidden value');
  assert.doesNotMatch(line, /https?:|code=|state=/);
  return caught;
}
test('real OIDC code/PKCE, sealed stateless transaction, rotating refresh and revoked session', async () => {
  assert.ok(process.env.TEST_REDIS_URL, 'TEST_REDIS_URL must name an isolated Redis instance');
  const issuer = await testIssuer(),
    origin = 'http://127.0.0.1:8099',
    namespace = 'test-' + randomUUID(),
    transactionSecret = secret();
  const env = {
    AUTH_MODE: 'oidc',
    AUTH_APP_ORIGIN: origin,
    AUTH_ISSUER: issuer.base,
    AUTH_REDIS_URL: process.env.TEST_REDIS_URL,
    AUTH_NAMESPACE: namespace,
    AUTH_CLIENT_ID: 'test-client',
    AUTH_INSECURE_LOOPBACK: 'true',
    AUTH_TRANSACTION_SECRET: transactionSecret,
  };
  const settings = identitySettings(env);
  const identity = new Identity(settings),
    second = new Identity(settings);
  const redis = createClient({ url: process.env.TEST_REDIS_URL });
  await redis.connect();
  const keys = async () => (await redis.keys(namespace + ':*')).length;
  const key = transactionKey(transactionSecret);
  // Follows the provider's redirect and returns the callback URL the browser would land on. hint picks the test account.
  const authorize = async (url, hint) => {
    const target = new URL(url);
    if (hint) target.searchParams.set('login_hint', hint);
    return new URL((await fetch(target, { redirect: 'manual' })).headers.get('location'));
  };
  const jar = (...starts) => Object.fromEntries(starts.map((start) => [start.name, start.cookie]));
  try {
    // Starting sign-in writes nothing to Redis, however often it is called.
    const before = { namespace: await keys(), all: await redis.dbSize() };
    const started = await Promise.all(Array.from({ length: 50 }, () => identity.begin('/projects')));
    assert.deepEqual({ namespace: await keys(), all: await redis.dbSize() }, before, 'begin() must not write Redis');
    assert.equal(new Set(started.map((s) => s.cookie)).size, 50, 'every cookie has its own IV and values');
    assert.equal(new Set(started.map((s) => s.name)).size, 50, 'every sign-in has its own cookie name');
    for (const start of started) assert.match(start.name, /^oidc_tx_[0-9a-f]{16}$/);
    // Well under the 4 KB browser limit, even with the longest return path.
    const longest = await identity.begin('/projects?' + 'q'.repeat(500));
    assert.ok(longest.cookie.length < 2048, `cookie is ${longest.cookie.length} characters`);
    assert.ok(/^v1\.[A-Za-z0-9_-]+$/.test(longest.cookie));
    // A browser keeps at most five sign-ins in progress: expired and unreadable ones go first, then the oldest.
    const expiredStart = {
      name: started[0].name,
      cookie: sealTransaction(
        key,
        { name: started[0].name, origin },
        openTransaction(key, { name: started[0].name, origin }, started[0].cookie),
        Date.now() - 301000,
      ),
    };
    assert.deepEqual(identity.staleTransactions({ ...jar(expiredStart), [started[1].name]: 'garbage', other: 'x' }), [
      started[0].name,
      started[1].name,
    ]);
    assert.deepEqual(identity.staleTransactions(jar(...started.slice(2, 6))), []);
    assert.equal(identity.staleTransactions(jar(...started.slice(2, 9))).length, 3);

    const begin = await identity.begin();
    const binding = { name: begin.name, origin };
    const callback = await authorize(begin.url);
    const sealed = openTransaction(key, binding, begin.cookie);
    assert.equal(begin.name, identity.transactionCookieName(callback.searchParams.get('state')));
    const forbidden = [
      begin.cookie,
      transactionSecret,
      sealed.verifier,
      sealed.state,
      sealed.nonce,
      callback.searchParams.get('code'),
      callback.href,
    ];
    // State, PKCE S256 and nonce bind the cookie to this authorization request.
    assert.equal(new URL(begin.url).searchParams.get('code_challenge_method'), 'S256');
    assert.equal(new URL(begin.url).searchParams.get('state'), sealed.state);
    assert.equal(new URL(begin.url).searchParams.get('nonce'), sealed.nonce);
    const wrong = new URL(callback);
    wrong.searchParams.set('state', 'wrong');
    await rejects(identity.complete(jar(begin), wrong), 'state_mismatch', forbidden);
    await rejects(identity.complete({}, callback), 'missing_transaction', forbidden);
    await rejects(identity.complete({ [begin.name]: '' }, callback), 'missing_transaction', forbidden);
    // Tampered: one character of the ciphertext changed.
    const at = begin.cookie.length - 10;
    const tampered = begin.cookie.slice(0, at) + (begin.cookie[at] === 'A' ? 'B' : 'A') + begin.cookie.slice(at + 1);
    await rejects(identity.complete({ [begin.name]: tampered }, callback), 'invalid_transaction', forbidden);
    await rejects(
      identity.complete({ [begin.name]: 'v2.' + begin.cookie.slice(3) }, callback),
      'invalid_transaction',
      forbidden,
    );
    await rejects(identity.complete({ [begin.name]: 'not a cookie' }, callback), 'invalid_transaction', forbidden);
    // Sealed for another app origin (associated data differs), with another secret, under another cookie name, or
    // with another payload version.
    const otherOrigin = new Identity(identitySettings({ ...env, AUTH_APP_ORIGIN: 'http://localhost:8099' }));
    const foreign = await otherOrigin.begin();
    otherOrigin.close();
    await rejects(identity.complete({ [begin.name]: foreign.cookie }, callback), 'invalid_transaction', forbidden);
    const otherSecret = sealTransaction(transactionKey(secret()), binding, sealed);
    await rejects(identity.complete({ [begin.name]: otherSecret }, callback), 'invalid_transaction', forbidden);
    const otherName = sealTransaction(key, { ...binding, name: started[2].name }, sealed);
    await rejects(identity.complete({ [begin.name]: otherName }, callback), 'invalid_transaction', forbidden);
    const version2 = sealPayload(key, binding, { ...sealed, v: 2, iat: Date.now() });
    await rejects(identity.complete({ [begin.name]: version2 }, callback), 'invalid_transaction', forbidden);
    // Expired by its sealed issue time, whatever the cookie's Max-Age said; and issued in the future.
    const expired = sealTransaction(key, binding, sealed, Date.now() - 301000);
    await rejects(identity.complete({ [begin.name]: expired }, callback), 'expired_transaction', forbidden);
    const future = sealTransaction(key, binding, sealed, Date.now() + 120000);
    await rejects(identity.complete({ [begin.name]: future }, callback), 'invalid_transaction', forbidden);
    // The provider reported an error on the callback (for example, the user declined consent).
    const declined = new URL(origin + '/auth/callback');
    declined.searchParams.set('error', 'access_denied');
    declined.searchParams.set('state', sealed.state);
    await rejects(identity.complete(jar(begin), declined), 'provider_error', forbidden, 'access_denied');
    declined.searchParams.set('error', 'https://evil.example/<script>');
    await rejects(identity.complete(jar(begin), declined), 'provider_error', forbidden, 'unrecognized');
    // Only another sign-in's cookie: the state does not match, and it is never a server error.
    const other = await identity.begin();
    await rejects(identity.complete(jar(other), callback), 'state_mismatch', forbidden);
    // None of the refusals above consumed the authorization code: this cookie and callback still sign in, even with
    // another tab's sign-in cookie present.
    const { sessionId: first, subject } = await identity.complete(jar(begin, other), callback);
    assert.equal(subject, 'oidc-alice');
    assert.equal(await identity.hasSession(first), true);
    // Replayed callback (same cookie, same code): the provider refuses the used code.
    await rejects(identity.complete(jar(begin), callback), 'token_exchange_failed', forbidden, 'invalid_grant');

    // Two tabs sign in at once: each callback finds its own cookie, so both succeed.
    const [tabA, tabB] = await Promise.all([identity.begin('/projects?tab=a'), identity.begin('/projects?tab=b')]);
    const [callbackA, callbackB] = await Promise.all([authorize(tabA.url), authorize(tabB.url)]);
    const both = jar(tabA, tabB);
    const [doneB, doneA] = await Promise.all([identity.complete(both, callbackB), second.complete(both, callbackA)]);
    assert.equal(doneA.returnTo, '/projects?tab=a');
    assert.equal(doneB.returnTo, '/projects?tab=b');
    assert.equal(await identity.hasSession(doneA.sessionId), true);
    assert.equal(await identity.hasSession(doneB.sessionId), true);

    // Signing in again as the same account replaces the old session without revoking the provider's tokens (they share
    // its single sign-on session): the old record is gone, and refresh keeps working.
    const revocations = issuer.stats().revocations;
    await identity.replace(doneA.sessionId, 'oidc-alice');
    assert.equal(await identity.hasSession(doneA.sessionId), false);
    assert.equal(issuer.stats().revocations, revocations, 'same-account re-login must not revoke provider tokens');
    // Switching account revokes the previous account's tokens.
    const bob = await identity.begin();
    const { sessionId: bobSession, subject: bobSubject } = await identity.complete(
      jar(bob),
      await authorize(bob.url, 'oidc-bob'),
    );
    assert.equal(bobSubject, 'oidc-bob');
    await identity.replace(doneB.sessionId, bobSubject);
    assert.equal(await identity.hasSession(doneB.sessionId), false);
    assert.equal(issuer.stats().revocations, revocations + 1, 'account switch revokes the old account');
    await identity.logout(bobSession);

    const next = await identity.begin('/projects/some-id?page=2');
    const url = await authorize(next.url);
    // The callback lands on another instance that shares only the secret.
    const { sessionId: id, returnTo } = await second.complete(jar(next), url);
    assert.equal(returnTo, '/projects/some-id?page=2', 'sign-in returns to the original same-origin page');
    assert.equal(await identity.hasSession(id), true);
    // The provider issued a 1-second access token, so this refreshes once, shared across instances.
    const refreshes = issuer.stats().refreshCount;
    const tokens = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? identity : second).token(id)));
    assert.ok(tokens.every((token) => token && token === tokens[0]));
    assert.equal(issuer.stats().refreshCount, refreshes + 1);
    // Re-login as the same account, then the new session's first refresh still succeeds.
    const again = await identity.begin();
    const { sessionId: renewed, subject: same } = await identity.complete(jar(again), await authorize(again.url));
    await identity.replace(id, same);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.ok(await identity.token(renewed), 'the new session refreshes after a same-account re-login');
    assert.equal(issuer.stats().refreshCount, refreshes + 2);
    const revoked = issuer.stats().revocations;
    await identity.logout(renewed);
    assert.equal(await second.token(renewed), undefined);
    assert.equal(issuer.stats().revocations, revoked + 1, 'explicit sign-out still revokes');
    assert.equal(await identity.token('forged'), undefined);
    issuer.outage(true);
    const down = await new Identity(settings).begin().catch((error) => error);
    assert.ok(down instanceof SignInError && down.reason === 'provider_unavailable');
    const unavailable = JSON.stringify(signInRecord('identity.login.unavailable', down, 'not-a-request-id'));
    assert.match(unavailable, /"event":"identity.login.unavailable".*"reason":"provider_unavailable"/);
    assert.doesNotMatch(unavailable, /not-a-request-id|127\.0\.0\.1/);
  } finally {
    identity.close();
    second.close();
    await redis.quit();
    await issuer.close();
  }
});
