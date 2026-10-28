import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { identitySettings, validateRuntime } from './runtime-config.mjs';

const local = {
  AUTH_MODE: 'oidc',
  AUTH_CLIENT_ID: 'test-client',
  AUTH_APP_ORIGIN: 'http://127.0.0.1:3000',
  AUTH_ISSUER: 'http://localhost:8080/realms/acme',
  AUTH_REDIS_URL: 'redis://127.0.0.1:6379',
  AUTH_INSECURE_LOOPBACK: 'true',
  AUTH_TRANSACTION_SECRET: randomBytes(32).toString('base64url'),
};
const failure = (env) => {
  try {
    identitySettings(env);
  } catch (error) {
    return { variable: error.variable, reason: error.reason };
  }
  return undefined;
};

test('insecure loopback mode accepts all-loopback settings', () => {
  assert.equal(identitySettings(local).insecure, true);
});
test('insecure loopback mode names the one host that is not loopback', () => {
  for (const [variable, value] of [
    ['AUTH_APP_ORIGIN', 'http://app.example'],
    ['AUTH_ISSUER', 'http://idp.example/realms/acme'],
    ['AUTH_REDIS_URL', 'redis://remote.example:6379'],
  ])
    assert.deepEqual(failure({ ...local, [variable]: value }), {
      variable,
      reason: 'must be a loopback host when AUTH_INSECURE_LOOPBACK=true',
    });
});
test('http origins need the insecure loopback flag', () => {
  assert.equal(failure({ ...local, AUTH_INSECURE_LOOPBACK: undefined })?.variable, 'AUTH_APP_ORIGIN');
});
test('API_BASE_URL must be https except on loopback', () => {
  assert.throws(() => validateRuntime({ API_BASE_URL: 'http://api.example' }), { variable: 'API_BASE_URL' });
  assert.equal(validateRuntime({ API_BASE_URL: 'http://127.0.0.1:4000' }).host, '127.0.0.1:4000');
});
test('AUTH_TRANSACTION_SECRET is required in oidc mode and must hold at least 32 random bytes', () => {
  const strong = randomBytes(48).toString('base64url');
  assert.equal(identitySettings({ ...local, AUTH_TRANSACTION_SECRET: strong }).transactionSecret, strong);
  assert.deepEqual(failure({ ...local, AUTH_TRANSACTION_SECRET: undefined }), {
    variable: 'AUTH_TRANSACTION_SECRET',
    reason: 'missing',
  });
  for (const weak of [
    randomBytes(31).toString('base64url'), // too short
    randomBytes(32).toString('base64'), // padded or standard alphabet, not base64url
    'A'.repeat(64), // one repeated byte
    Buffer.from('password'.repeat(8)).toString('base64url'), // few distinct bytes
    randomBytes(32).toString('base64url') + ' ',
  ])
    assert.deepEqual(failure({ ...local, AUTH_TRANSACTION_SECRET: weak }), {
      variable: 'AUTH_TRANSACTION_SECRET',
      reason: 'must be base64url encoding at least 32 random bytes',
    });
  assert.equal(identitySettings({ AUTH_MODE: 'external-cookie' }), undefined, 'not needed without oidc');
});
