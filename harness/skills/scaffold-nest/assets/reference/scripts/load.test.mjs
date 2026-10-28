import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { measure } from './load.mjs';
test('load probe counts real successes/failures and enforces budgets without leaking bearer', async () => {
  let seen = 0;
  const server = createServer((req, res) => {
    seen++;
    assert.equal(req.headers.authorization, 'Bearer synthetic');
    res.writeHead(seen % 2 ? 200 : 503);
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await measure({
      url: 'http://127.0.0.1:' + server.address().port,
      requests: 10,
      concurrency: 2,
      token: 'synthetic',
    });
    assert.equal(seen, 10);
    assert.equal(result.errorRate, 0.5);
    assert.equal(result.passed, false);
    assert.equal(result.statusCounts[200], 5);
    assert.ok(!JSON.stringify(result).includes('synthetic'));
    await assert.rejects(measure({ url: 'http://localhost', requests: 0 }));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
