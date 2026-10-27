import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
test('production entry rejects missing and invalid API configuration', () => {
  // secretlint-disable-next-line @secretlint/secretlint-rule-basicauth -- Synthetic invalid URL; verifies userinfo is rejected.
  for (const value of ['', 'http://example.com', 'https://example.com/path', 'https://user:secret@example.com']) {
    const result = spawnSync(process.execPath, ['scripts/start.mjs'], {
      env: { ...process.env, API_BASE_URL: value },
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /"errorType":"INVALID_CONFIGURATION","variable":"API_BASE_URL"/);
    assert.doesNotMatch(result.stderr, /secret|example\.com/, 'never print the value');
  }
});
test('compiled runtime emits changing CSP nonces and closes on SIGTERM', { timeout: 60000 }, async () => {
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const child = spawn(process.execPath, ['scripts/start.mjs'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      API_BASE_URL: 'http://127.0.0.1:1',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
    },
    stdio: 'ignore',
  });
  const exited = once(child, 'exit');
  try {
    let response;
    // Deadline-based so a loaded CI host is slow, not flaky. Override with TEST_READY_TIMEOUT_MS.
    for (const deadline = Date.now() + Number(process.env.TEST_READY_TIMEOUT_MS ?? 20000); Date.now() < deadline;) {
      if (child.exitCode !== null) throw new Error('Compiled Next process exited before readiness');
      try {
        response = await fetch(`http://127.0.0.1:${port}/projects`);
        if (response.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(response?.ok, 'production runtime failed to boot');
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /nonce-/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
    const second = await fetch(`http://127.0.0.1:${port}/projects`);
    assert.notEqual(second.headers.get('content-security-policy'), csp);
    assert.match(second.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
    child.kill('SIGTERM');
    const [code, signal] = await Promise.race([
      exited,
      new Promise((_, reject) => setTimeout(() => reject(new Error('SIGTERM exceeded 5 seconds')), 5000).unref()),
    ]);
    assert.equal(code, 0, 'SIGTERM drains in-flight requests and exits 0');
    assert.equal(signal, null, 'the start script must handle SIGTERM, not the operating system');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  }
});
