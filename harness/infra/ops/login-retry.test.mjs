import assert from 'node:assert/strict';
import test from 'node:test';
import { loginRetryDecision, safeLoginUrl } from './login-retry.mjs';

const networkChange = new Error('page.goto: net::ERR_NETWORK_CHANGED');
const usernameTimeout = new Error("page.waitForSelector: Timeout 30000ms exceeded\nwaiting for locator('#username') to be visible");

test('retries a bounded login after runner network churn and its immediate aftermath', () => {
  const first = loginRetryDecision(networkChange, 0, false);
  assert.deepEqual(first, { retry: true, reason: 'network_changed', sawNetworkChange: true });
  assert.deepEqual(loginRetryDecision(usernameTimeout, 1, first.sawNetworkChange), {
    retry: true,
    reason: 'login_form_absent_after_network_change',
    sawNetworkChange: true,
  });
  assert.equal(loginRetryDecision(usernameTimeout, 3, true).retry, false);
  assert.equal(loginRetryDecision(networkChange, 3, true).retry, false);
});

test('does not retry an absent login form without a recorded network change', () => {
  assert.deepEqual(loginRetryDecision(usernameTimeout, 0, false), {
    retry: false,
    reason: null,
    sawNetworkChange: false,
  });
  assert.equal(loginRetryDecision(new Error('page.goto: Timeout 30000ms exceeded'), 1, true).retry, false);
});

test('records only origin and path from the current login URL', () => {
  assert.equal(safeLoginUrl('https://id.acme.test:8443/realms/acme/login?state=secret&code=secret'), 'https://id.acme.test:8443/realms/acme/login');
  assert.equal(safeLoginUrl('not a URL'), 'unavailable');
});
