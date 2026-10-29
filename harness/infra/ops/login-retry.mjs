const NETWORK_CHANGED = 'ERR_NETWORK_CHANGED';
const USERNAME_TIMEOUT = /page\.waitForSelector: Timeout[\s\S]*locator\('#username'\)/;

export function loginRetryDecision(error, attempt, sawNetworkChange) {
  const message = String(error);
  const networkChanged = message.includes(NETWORK_CHANGED);
  const networkChangeAftermath = sawNetworkChange && USERNAME_TIMEOUT.test(message);
  const reason = networkChanged ? 'network_changed' : networkChangeAftermath ? 'login_form_absent_after_network_change' : null;
  return {
    retry: attempt < 3 && reason !== null,
    reason,
    sawNetworkChange: sawNetworkChange || networkChanged,
  };
}

export function safeLoginUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return 'unavailable';
  }
}
