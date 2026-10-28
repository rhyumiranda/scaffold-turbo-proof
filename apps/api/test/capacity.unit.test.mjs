import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, request } from 'node:http';
import { capacityLimit } from '../dist/platform/capacity.js';
test('capacity rejects overload before parsing, keeps liveness and releases disconnected work', async () => {
  const app = express();
  app.use((_q, s, n) => {
    s.setHeader('x-request-id', '12345678-1234-4234-8234-123456789012');
    n();
  });
  app.use(capacityLimit(1));
  app.use(express.json());
  app.post('/work', (_q, s) => s.end('done'));
  app.get('/health/live', (_q, s) => s.end('ok'));
  const server = createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const held = request(base + '/work', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': 100 },
  });
  held.on('error', () => {});
  held.write('{');
  try {
    // A second request on the same event loop follows the held request's headers.
    let response;
    for (let n = 0; n < 20; n++) {
      response = await fetch(base + '/work', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      });
      if (response.status === 503) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '1');
    assert.equal((await fetch(base + '/health/live')).status, 200);
    held.destroy();
    for (let n = 0; n < 20; n++) {
      response = await fetch(base + '/work', {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      });
      if (response.status === 200) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(response.status, 200);
  } finally {
    held.destroy();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
