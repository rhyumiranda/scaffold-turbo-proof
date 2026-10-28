import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect, createServer } from 'node:net';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
// Opens a connection that trickles header lines forever; resolves with how long the server took to drop it.
function slowHeaders(port) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = connect(port, '127.0.0.1', () => socket.write('GET / HTTP/1.1\r\nHost: slow\r\n'));
    const trickle = setInterval(() => socket.write('X-Slow: 1\r\n'), 300);
    socket.on('error', () => {});
    socket.on('close', () => {
      clearInterval(trickle);
      resolve(Date.now() - started);
    });
  });
}
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function launch(file, env = {}) {
  const child = spawn(process.execPath, [file], {
    env: { ...process.env, TELEMETRY_EXPORTER: 'none', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const ended = once(child, 'exit');
  return { child, ended, output: () => output };
}
// Deadline-based so a loaded CI host is slow, not flaky. Override with TEST_READY_TIMEOUT_MS.
const readyTimeout = Number(process.env.TEST_READY_TIMEOUT_MS ?? 20000);
async function waitFor(process, match) {
  for (const deadline = Date.now() + readyTimeout; Date.now() < deadline;) {
    if (match(process.output())) return;
    if (process.child.exitCode !== null) throw new Error('Process exited: ' + process.output());
    await delay(50);
  }
  throw new Error('Process did not reach expected state');
}
async function stop(process) {
  if (process.child.exitCode !== null || process.child.signalCode !== null) return;
  process.child.kill('SIGTERM');
  const timeout = setTimeout(() => process.child.kill('SIGKILL'), 10000);
  await process.ended;
  clearTimeout(timeout);
}
test('real API boots, emits safe correlated traces/metrics, and exits on SIGTERM', async () => {
  assert.equal(globalThis.process.env.NODE_ENV, 'test');
  assert.ok(globalThis.process.env.DATABASE_URL);
  const port = await unusedPort();
  const process = launch('dist/main.js', {
    PORT: String(port),
    AUTH_ISSUER: 'https://example.invalid',
    AUTH_AUDIENCE: 'test',
    AUTH_JWKS_URL: 'https://example.invalid/jwks',
    TELEMETRY_EXPORTER: 'console',
  });
  try {
    await waitFor(process, (text) => text.includes('startup.ready'));
    const response = await fetch(`http://127.0.0.1:${port}/health/ready?secret=never-log-this`, {
      headers: {
        authorization: 'Bearer never-log-this',
        traceparent: '00-12345678901234567890123456789012-1234567890123456-01',
        'x-request-id': '12345678-1234-4234-8234-123456789012',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-trace-id'), '12345678901234567890123456789012');
    assert.equal(response.headers.get('x-request-id'), '12345678-1234-4234-8234-123456789012');
    const started = Date.now();
    const uploadStatus = await new Promise((resolve, reject) => {
      const upload = httpRequest(
        `http://127.0.0.1:${port}/v1/projects`,
        { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '1000' } },
        (result) => {
          result.resume();
          resolve(result.statusCode);
        },
      );
      upload.on('error', reject);
      upload.write('{');
    });
    assert.equal(uploadStatus, 408);
    assert.ok(Date.now() - started < 7500);
    // headersTimeout is 5 s; the connection sweep must enforce it promptly, not up to 30 s later.
    const dropped = await slowHeaders(port);
    assert.ok(dropped < 7000, `slow-header client held for ${dropped} ms`);
    await stop(process);
    assert.equal(process.child.exitCode, 0);
    assert.ok(process.output().includes('shutdown.complete'));
    assert.ok(process.output().includes('postgres.query'));
    assert.ok(process.output().includes('http.server.requests'));
    assert.ok(!process.output().includes('never-log-this'));
    assert.ok(!/"status":5\d\d/.test(process.output()), 'malformed input must not produce server errors');
  } finally {
    await stop(process);
  }
});
test('dependency failure affects readiness, not liveness, within its budget', async () => {
  const port = await unusedPort(),
    unavailable = await unusedPort();
  const process = launch('dist/main.js', {
    PORT: String(port),
    // secretlint-disable-next-line @secretlint/secretlint-rule-database-connection-string -- Synthetic closed loopback port; tests redaction, never a real credential.
    DATABASE_URL: `postgresql://test:never-log-this@127.0.0.1:${unavailable}/missing`,
    AUTH_ISSUER: 'https://example.invalid',
    AUTH_AUDIENCE: 'test',
    AUTH_JWKS_URL: 'https://example.invalid/jwks',
  });
  try {
    await waitFor(process, (text) => text.includes('startup.ready'));
    assert.equal((await fetch(`http://127.0.0.1:${port}/health/live`)).status, 200);
    const started = Date.now();
    const response = await fetch(`http://127.0.0.1:${port}/health/ready`);
    assert.equal(response.status, 503);
    assert.ok(Date.now() - started < 6000);
    const body = await response.json();
    assert.equal(body.code, 'UNAVAILABLE');
    await stop(process);
    assert.ok(process.output().includes('request.failure'));
    assert.ok(!process.output().includes('never-log-this'));
  } finally {
    await stop(process);
  }
});
test('missing configuration fails before serving without leaking values', async () => {
  const process = launch('dist/main.js', { DATABASE_URL: '', AUTH_ISSUER: 'never-log-this' });
  const [code] = await process.ended;
  assert.equal(code, 1);
  assert.ok(process.output().includes('startup.failure'));
  assert.ok(!process.output().includes('never-log-this'));
});
test('unsafe telemetry endpoint fails startup without revealing credentials', async () => {
  for (const endpoint of ['ftp://localhost:4318', 'https://user:never-log-this@example.invalid']) {
    const port = await unusedPort();
    const process = launch('dist/main.js', {
      PORT: String(port),
      AUTH_ISSUER: 'https://example.invalid',
      AUTH_AUDIENCE: 'test',
      AUTH_JWKS_URL: 'https://example.invalid/jwks',
      TELEMETRY_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
    });
    try {
      await waitFor(process, (text) => text.includes('startup.failure') || text.includes('startup.ready'));
      assert.ok(process.output().includes('startup.failure'), 'Unsafe endpoint was accepted at startup');
      await process.ended;
      assert.equal(process.child.exitCode, 1);
      assert.ok(!process.output().includes('never-log-this'));
    } finally {
      await stop(process);
    }
  }
});
for (const [name, work, deadline, expected] of [
  ['drain', 300, 2000, 0],
  ['bounded forced exit', 3000, 150, 1],
])
  test(name, async () => {
    const process = launch('test/fixtures/drain-server.mjs', {
      WORK_MS: String(work),
      SHUTDOWN_TIMEOUT_MS: String(deadline),
    });
    try {
      await waitFor(process, (text) => text.includes('"port"'));
      const port = JSON.parse(
        process
          .output()
          .split('\n')
          .find((line) => line.includes('"port"')),
      ).port;
      const request = fetch(`http://127.0.0.1:${port}`)
        .then((response) => response.text())
        .catch(() => 'closed');
      await waitFor(process, (text) => text.includes('request.started'));
      const started = Date.now();
      await stop(process);
      assert.equal(process.child.exitCode, expected);
      assert.ok(Date.now() - started < deadline + 1500);
      assert.equal(await request, expected === 0 ? 'completed' : 'closed');
    } finally {
      await stop(process);
    }
  });
