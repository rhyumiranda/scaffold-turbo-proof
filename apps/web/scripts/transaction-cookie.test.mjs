import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  openTransaction,
  sealPayload,
  sealTransaction,
  transactionKey,
  TRANSACTION_SECONDS,
} from '../src/lib/transaction-cookie.mjs';

const key = transactionKey(randomBytes(32).toString('base64url'));
const binding = { name: '__Host-oidc_tx_0123456789abcdef', origin: 'https://app.example' };
const transaction = {
  verifier: randomBytes(32).toString('base64url'),
  state: randomBytes(32).toString('base64url'),
  nonce: randomBytes(32).toString('base64url'),
  returnTo: '/projects?page=2',
};
const reason = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.reason;
  }
  return 'opened';
};

test('a sealed transaction opens only with the same key, cookie name and origin', () => {
  const now = Date.now();
  const cookie = sealTransaction(key, binding, transaction, now);
  assert.deepEqual(openTransaction(key, binding, cookie, now + 1000), { ...transaction, issuedAt: now });
  for (const value of Object.values(transaction)) assert.ok(!cookie.includes(value), 'values are encrypted');
  assert.notEqual(sealTransaction(key, binding, transaction, now), cookie, 'a fresh IV per cookie');
  const other = transactionKey(randomBytes(32).toString('base64url'));
  assert.equal(
    reason(() => openTransaction(other, binding, cookie, now)),
    'invalid_transaction',
  );
  assert.equal(
    reason(() => openTransaction(key, { ...binding, origin: 'https://evil.example' }, cookie, now)),
    'invalid_transaction',
  );
  assert.equal(
    reason(() => openTransaction(key, { ...binding, name: '__Host-oidc_tx_fedcba9876543210' }, cookie, now)),
    'invalid_transaction',
  );
});

test('tampering, truncation, other versions and malformed payloads are invalid; old ones expire', () => {
  const now = Date.now();
  const cookie = sealTransaction(key, binding, transaction, now);
  for (let i = 3; i < cookie.length; i += 7) {
    const flipped = cookie.slice(0, i) + (cookie[i] === 'A' ? 'B' : 'A') + cookie.slice(i + 1);
    assert.equal(
      reason(() => openTransaction(key, binding, flipped, now)),
      'invalid_transaction',
      `position ${i}`,
    );
  }
  for (const bad of ['', 'v1.', 'v1.AAAA', cookie.slice(0, -4), 'v2' + cookie.slice(2), cookie + '=', 'x'.repeat(5000)])
    assert.equal(
      reason(() => openTransaction(key, binding, bad, now)),
      'invalid_transaction',
    );
  for (const payload of [
    { ...transaction, v: 2, iat: now },
    { ...transaction, v: 1 },
    { ...transaction, v: 1, iat: now, state: 'short' },
    { ...transaction, v: 1, iat: now, returnTo: 5 },
    ['not', 'an', 'object'],
  ])
    assert.equal(
      reason(() => openTransaction(key, binding, sealPayload(key, binding, payload), now)),
      'invalid_transaction',
    );
  const limit = TRANSACTION_SECONDS * 1000;
  assert.equal(
    reason(() => openTransaction(key, binding, cookie, now + limit)),
    'opened',
  );
  assert.equal(
    reason(() => openTransaction(key, binding, cookie, now + limit + 1)),
    'expired_transaction',
  );
  assert.equal(
    reason(() => openTransaction(key, binding, cookie, now - 60000)),
    'invalid_transaction',
    'issued later',
  );
});

test('the cookie stays well under the 4 KB browser limit', () => {
  const cookie = sealTransaction(key, binding, { ...transaction, returnTo: '/' + 'q'.repeat(511) });
  assert.ok(cookie.length < 2048, `${cookie.length} characters`);
});
