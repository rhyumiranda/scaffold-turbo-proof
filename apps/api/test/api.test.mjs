import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { assertResponse } from './schema.mjs';
let issuer, app, base, alice, bob, expired, wrongAudience, noAudience, otherIssuer;
before(async () => {
  assert.equal(process.env.NODE_ENV, 'test', 'Run with NODE_ENV=test and a dedicated test database');
  assert.ok(process.env.DATABASE_URL, 'Dedicated DATABASE_URL required');
  const keys = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  issuer = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => issuer.listen(0, '127.0.0.1', resolve));
  process.env.AUTH_ISSUER = 'http://127.0.0.1:' + issuer.address().port;
  process.env.AUTH_JWKS_URL = process.env.AUTH_ISSUER + '/jwks';
  process.env.AUTH_AUDIENCE = 'reference-test';
  const migration = spawnSync(process.execPath, ['scripts/migrate.mjs'], { env: process.env, encoding: 'utf8' });
  assert.equal(migration.status, 0, migration.stderr);
  const sign = (
    subject,
    lifetime = '5m',
    { audience = process.env.AUTH_AUDIENCE, iss = process.env.AUTH_ISSUER } = {},
  ) => {
    const jwt = new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject(subject)
      .setIssuer(iss)
      .setIssuedAt()
      .setExpirationTime(lifetime);
    if (audience) jwt.setAudience(audience);
    return jwt.sign(keys.privateKey);
  };
  alice = await sign('alice');
  bob = await sign('bob');
  expired = await sign('expired', '-1m');
  wrongAudience = await sign('alice', '5m', { audience: 'some-other-api' });
  noAudience = await sign('alice', '5m', { audience: null });
  otherIssuer = await sign('alice', '5m', { iss: 'https://other-issuer.example' });
  const { createApp } = await import('../dist/app.js');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => {
  if (app) await app.close();
  if (issuer) await new Promise((resolve) => issuer.close(resolve));
});
function call(path, token, method = 'GET', body) {
  return fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
test('health requires a real reachable database', async () => {
  assert.equal((await call('/health/live')).status, 200);
  assert.equal((await call('/health/ready')).status, 200);
});
test('parser failures are safe client errors; valid gzip remains supported', async () => {
  for (const [extra, status] of [
    [{ 'content-type': 'application/json; charset=iso-8859-1' }, 415],
    [{ 'content-encoding': 'unsupported' }, 415],
    [{ 'content-encoding': 'gzip' }, 400],
  ]) {
    const response = await fetch(base + '/v1/projects', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + alice, 'content-type': 'application/json', ...extra },
      body: '{"name":"parser-probe"}',
    });
    assert.equal(response.status, status);
    const problem = await response.json();
    assert.equal(problem.code, status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'INVALID_INPUT');
    assertResponse('/v1/projects', 'post', status, problem);
    assert.ok(!JSON.stringify(problem).includes('parser-probe'));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const response = await fetch(base + '/v1/projects', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + alice, 'content-type': 'application/json', 'content-encoding': 'gzip' },
    body: gzipSync(JSON.stringify({ name: 'Valid compressed body' })),
  });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).name, 'Valid compressed body');
});
test('oversized version is invalid input, not a database failure; record is unchanged', async () => {
  const created = await call('/v1/projects', alice, 'POST', { name: 'Version range' });
  assert.equal(created.status, 201);
  const project = await created.json();
  for (const expectedVersion of [2147483648, Number.MAX_SAFE_INTEGER]) {
    const response = await call('/v1/projects/' + project.id, alice, 'PATCH', { name: 'Changed', expectedVersion });
    assert.equal(response.status, 400);
    const problem = await response.json();
    assert.equal(problem.code, 'INVALID_INPUT');
    assert.ok(problem.errors.some((error) => error.field === 'expectedVersion'));
    assert.equal(problem.title, 'Bad Request');
    assert.equal(problem.instance, '/v1/projects/' + project.id);
  }
  assert.deepEqual(await (await call('/v1/projects/' + project.id, alice)).json(), project);
  assert.equal(
    (await call('/v1/projects/' + project.id, alice, 'PATCH', { name: 'Stale', expectedVersion: 2147483647 })).status,
    409,
  );
});
test('NUL creates and renames fail without changing persisted state; Unicode succeeds', async () => {
  const before = await (await call('/v1/projects?limit=100', alice)).json();
  const invalid = await call('/v1/projects', alice, 'POST', { name: 'a\u0000b' });
  assert.equal(invalid.status, 400);
  const problem = await invalid.json();
  assert.equal(problem.code, 'INVALID_INPUT');
  assert.ok(problem.errors.some((error) => error.field === 'name' && error.message.includes('null character')));
  assert.ok(
    !JSON.stringify(problem).includes(JSON.stringify('a\u0000b').slice(1, -1)),
    'problem never echoes the submitted value',
  );
  assert.deepEqual(await (await call('/v1/projects?limit=100', alice)).json(), before);
  const created = await call('/v1/projects', alice, 'POST', { name: '😀漢字é' });
  assert.equal(created.status, 201);
  const project = await created.json();
  assert.equal(
    (await call('/v1/projects/' + project.id, alice, 'PATCH', { name: 'a\u0000b', expectedVersion: 1 })).status,
    400,
  );
  assert.deepEqual(await (await call('/v1/projects/' + project.id, alice)).json(), project);
});
test('missing, forged and expired credentials fail closed', async () => {
  for (const token of [undefined, 'forged', expired]) assert.equal((await call('/v1/projects', token)).status, 401);
  // A validly signed token for another API, with no audience, or from another issuer must never be accepted.
  for (const token of [wrongAudience, noAudience, otherIssuer]) {
    assert.equal((await call('/v1/projects', token)).status, 401);
    assert.equal((await call('/v1/projects', token, 'POST', { name: 'Should not exist' })).status, 401);
  }
});
test('validation rejects unknown fields, blanks and unbounded queries', async () => {
  for (const body of [{ name: '   ' }, { name: 'x', owner_id: 'bob' }, { name: 'x'.repeat(101) }])
    assert.equal((await call('/v1/projects', alice, 'POST', body)).status, 400);
  assert.equal((await call('/v1/projects?limit=101', alice)).status, 400);
  for (const query of ['offset=', 'limit=', 'limit=abc', 'offset=1.5'])
    assert.equal((await call('/v1/projects?' + query, alice)).status, 400, query);
  assert.equal((await call('/v1/projects', alice)).status, 200, 'absent values keep their defaults');
});
test('body parser rejects oversized and malformed JSON with documented client errors', async () => {
  const tooLarge = await fetch(base + '/v1/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x'.repeat(40000) }),
  });
  assert.equal(tooLarge.status, 413);
  const problem = await tooLarge.json();
  assert.equal(problem.code, 'PAYLOAD_TOO_LARGE');
  assertResponse('/v1/projects', 'post', 413, problem);
  const malformed = await fetch(base + '/v1/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"name":',
  });
  assert.equal(malformed.status, 400);
  assertResponse('/v1/projects', 'post', 400, await malformed.json());
});
test('ownership, safe DTOs, persistence and atomic version conflict', async () => {
  const created = await call('/v1/projects', alice, 'POST', { name: ' Reference ' });
  assert.equal(created.status, 201);
  const project = await created.json();
  assert.deepEqual(Object.keys(project).sort(), ['createdAt', 'id', 'name', 'version']);
  assertResponse('/v1/projects', 'post', 201, project);
  assert.equal(project.name, 'Reference');
  assert.equal((await call('/v1/projects/' + project.id, bob)).status, 404);
  assert.equal(
    (await call('/v1/projects/' + project.id, bob, 'PATCH', { name: 'Stolen', expectedVersion: 1 })).status,
    404,
  );
  const attempts = await Promise.all(
    ['First', 'Second'].map((name) => call('/v1/projects/' + project.id, alice, 'PATCH', { name, expectedVersion: 1 })),
  );
  assert.deepEqual(attempts.map((x) => x.status).sort(), [200, 409]);
  const saved = await (await call('/v1/projects/' + project.id, alice)).json();
  assert.equal(saved.version, 2);
  const list = await (await call('/v1/projects?limit=100', bob)).json();
  assertResponse('/v1/projects', 'get', 200, list);
  assert.ok(!list.some((x) => x.id === project.id));
  const invalid = await call('/v1/projects/' + project.id, alice, 'PATCH', { name: 'stale', expectedVersion: 1 });
  const problem = await invalid.json();
  assertResponse('/v1/projects/{id}', 'patch', 409, problem);
  assert.equal(problem.code, 'VERSION_CONFLICT');
  assert.equal(problem.title, 'Conflict');
  assert.match(problem.detail, /changed/);
  assert.ok(problem.requestId);
  assert.equal(problem.stack, undefined);
});
