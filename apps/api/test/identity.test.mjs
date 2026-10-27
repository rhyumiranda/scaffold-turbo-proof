import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createApp } from '../dist/app.js';
test('real API accepts rotated JWKS, rejects old/forged tokens and fails closed after cache expiry during outage', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(process.env.DATABASE_URL);
  const first = await generateKeyPair('RS256'),
    second = await generateKeyPair('RS256');
  let outage = false;
  let jwk = { ...(await exportJWK(first.publicKey)), kid: 'first', alg: 'RS256', use: 'sig' };
  const server = createServer((_q, s) => {
    s.setHeader('content-type', 'application/json');
    if (outage) {
      s.writeHead(503);
      s.end('{}');
    } else s.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const issuer = 'http://127.0.0.1:' + server.address().port;
  const previous = { ...process.env };
  Object.assign(process.env, {
    AUTH_ISSUER: issuer,
    AUTH_JWKS_URL: issuer + '/jwks',
    AUTH_AUDIENCE: 'rotation-test',
    AUTH_JWKS_COOLDOWN_MS: '1',
    AUTH_JWKS_CACHE_MS: '50',
  });
  const app = await createApp();
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const sign = (key, kid) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid })
      .setSubject('rotation-test')
      .setIssuer(issuer)
      .setAudience('rotation-test')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
  const call = (token) => fetch(base + '/v1/projects', { headers: { authorization: 'Bearer ' + token } });
  try {
    assert.equal((await call(await sign(first.privateKey, 'first'))).status, 200);
    jwk = { ...(await exportJWK(second.publicKey)), kid: 'second', alg: 'RS256', use: 'sig' };
    await new Promise((r) => setTimeout(r, 60));
    const token = await sign(second.privateKey, 'second');
    assert.equal((await call(token)).status, 200);
    assert.equal((await call(await sign(first.privateKey, 'first'))).status, 401);
    outage = true;
    await new Promise((r) => setTimeout(r, 60));
    assert.equal((await call(token)).status, 401);
    assert.equal((await fetch(base + '/health/live')).status, 200);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
