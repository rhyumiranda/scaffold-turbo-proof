import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { collector } from '../scripts/collector.mjs';
test('actual runtime exports correlated HTTP/database spans and metrics to loopback OTLP', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(process.env.DATABASE_URL);
  const receiver = await collector(),
    socket = createServer();
  await new Promise((r) => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port;
  await new Promise((r) => socket.close(r));
  const child = spawn(process.execPath, ['dist/main.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      AUTH_ISSUER: 'https://identity.example.invalid',
      AUTH_AUDIENCE: 'test',
      AUTH_JWKS_URL: 'https://identity.example.invalid/jwks',
      TELEMETRY_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_ENDPOINT: receiver.endpoint,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ended = once(child, 'exit');
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  try {
    for (let i = 0; i < 100 && !output.includes('startup.ready'); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(output.includes('startup.ready'));
    const response = await fetch('http://127.0.0.1:' + port + '/health/ready?secret=never-log-this', {
      headers: { authorization: 'Bearer never-log-this' },
    });
    assert.equal(response.status, 200);
    await response.arrayBuffer();
    assert.equal((await receiver.verify()).passed, true);
    assert.ok(!output.includes('never-log-this'));
  } finally {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    await ended;
    clearTimeout(timer);
    await receiver.close();
  }
});
