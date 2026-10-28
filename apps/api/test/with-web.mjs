// Refuses to run unless NODE_ENV=test and the database name ends in _test (it writes and never cleans up).
import './test-database.mjs';
import { createServer, request as proxyRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createApp } from '../dist/app.js';
import { pathToFileURL } from 'node:url';
import { collector } from '../scripts/collector.mjs';
import { startTelemetry } from '../dist/platform/telemetry.js';
if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL || !process.argv[2])
  throw new Error('Use NODE_ENV=test DATABASE_URL=<dedicated test DB> node test/with-web.mjs /absolute/web-project');

const web = resolve(process.argv[2]),
  owned = [];
let app,
  issuer,
  oidcIssuer,
  receiver,
  telemetry,
  reservation,
  proxy,
  interrupted = false,
  result = 1;
async function freePort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
function start(file, args, options) {
  const grouped = process.platform !== 'win32';
  const child = spawn(file, args, { ...options, detached: grouped, stdio: 'inherit' });
  const done = new Promise((resolve) => {
    child.once('error', () => resolve(1));
    child.once('exit', (code) => resolve(code ?? 1));
  });
  const record = { child, done, grouped };
  owned.push(record);
  return record;
}
function signal(record, name) {
  try {
    if (record.grouped && record.child.pid) process.kill(-record.child.pid, name);
    else if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(name);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
async function bounded(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Cleanup deadline exceeded')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function reap(record) {
  signal(record, 'SIGTERM');
  try {
    await bounded(record.done, 2000);
  } catch {
    /* The owned process group is forcibly reaped below. */
  }
  signal(record, 'SIGKILL');
  await bounded(record.done, 1000);
}
function onSignal() {
  interrupted = true;
  for (const record of owned) signal(record, 'SIGTERM');
}
function checkInterrupted() {
  if (interrupted) throw new Error('Integration interrupted');
}
process.on('SIGTERM', onSignal);
process.on('SIGINT', onSignal);
try {
  if (process.env.TEST_TELEMETRY === 'true') {
    receiver = await collector();
    process.env.TELEMETRY_EXPORTER = 'otlp';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = receiver.endpoint;
    process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/json';
    telemetry = startTelemetry();
  }
  const keys = await generateKeyPair('RS256');
  checkInterrupted();
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'browser-test', alg: 'RS256', use: 'sig' };
  issuer = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => issuer.listen(0, '127.0.0.1', resolve));
  checkInterrupted();
  process.env.AUTH_ISSUER = 'http://127.0.0.1:' + issuer.address().port;
  process.env.AUTH_JWKS_URL = process.env.AUTH_ISSUER + '/jwks';
  process.env.AUTH_AUDIENCE = 'browser-test';
  if (process.env.TEST_OIDC === 'true') {
    const { testIssuer } = await import(pathToFileURL(join(web, 'tests/oidc-provider.mjs')).href);
    oidcIssuer = await testIssuer('browser-test');
    process.env.AUTH_ISSUER = oidcIssuer.base;
    process.env.AUTH_JWKS_URL = oidcIssuer.base + '/jwks';
  }
  const migration = start(process.execPath, ['scripts/migrate.mjs'], { env: process.env });
  if ((await migration.done) !== 0) throw new Error('Migrations failed');
  checkInterrupted();
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  checkInterrupted();
  const api = await app.getUrl();
  reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  checkInterrupted();
  const url = 'http://127.0.0.1:' + port;
  const env = { ...process.env, NODE_ENV: 'production', API_BASE_URL: api, PORT: String(port), HOSTNAME: '127.0.0.1' };
  if (oidcIssuer)
    Object.assign(env, {
      AUTH_MODE: 'oidc',
      AUTH_APP_ORIGIN: url,
      AUTH_CLIENT_ID: 'test-client',
      AUTH_NAMESPACE: 'browser-' + randomUUID(),
      AUTH_REDIS_URL: process.env.TEST_REDIS_URL,
      AUTH_INSECURE_LOOPBACK: 'true',
    });
  const replicas = process.env.TEST_REPLICAS ?? '1';
  if (!['1', '2'].includes(replicas)) throw new Error('TEST_REPLICAS must be 1 or 2');
  const ports = replicas === '2' ? [await freePort(), await freePort()] : [port];
  const servers = ports.map((value) =>
    start(process.execPath, [join(web, 'scripts/start.mjs')], { cwd: web, env: { ...env, PORT: String(value) } }),
  );
  if (replicas === '2') {
    proxy = createServer((request, response) => {
      // Deliberately render on replica A and mutate on replica B, using one public origin.
      const upstream = proxyRequest(
        {
          host: '127.0.0.1',
          port: request.method === 'POST' ? ports[1] : ports[0],
          path: request.url,
          method: request.method,
          headers: request.headers,
        },
        (incoming) => {
          response.writeHead(incoming.statusCode, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(503);
        response.end();
      });
      request.on('aborted', () => upstream.destroy());
      request.pipe(upstream);
    });
    await new Promise((r) => proxy.listen(port, '127.0.0.1', r));
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    checkInterrupted();
    if (servers.some((server) => server.child.exitCode !== null)) throw new Error('Next exited before ready');
    try {
      if (
        (
          await Promise.all(
            ports.map((value) =>
              fetch('http://127.0.0.1:' + value + '/projects', { signal: AbortSignal.timeout(1000) }),
            ),
          )
        ).every((response) => response.ok)
      )
        break;
    } catch {}
    if (attempt === 99) throw new Error('Next readiness timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const run = randomUUID();
  const sign = (subject) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'browser-test' })
      .setSubject(subject + '-' + run)
      .setIssuer(process.env.AUTH_ISSUER)
      .setAudience(process.env.AUTH_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey);
  const testEnv = {
    ...env,
    WEB_TEST_URL: url,
    TEST_API_URL: api,
    TEST_ALICE_TOKEN: await sign('browser-alice'),
    TEST_BOB_TOKEN: await sign('browser-bob'),
  };
  checkInterrupted();
  const tests = start(
    process.execPath,
    [join(web, 'node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(3)],
    { cwd: web, env: testEnv },
  );
  result = await tests.done;
  if (receiver && result === 0) console.log(JSON.stringify(await receiver.verify({ paired: true })));
} catch (error) {
  result = 1;
  if (error?.name === 'AssertionError') console.error(error.message);
  console.error(
    interrupted
      ? 'Browser integration interrupted; cleaning owned processes'
      : 'Browser integration failed; inspect preceding test output',
  );
} finally {
  try {
    await Promise.all(owned.map(reap));
    if (proxy) {
      proxy.closeAllConnections();
      await bounded(new Promise((r) => proxy.close(r)), 1000);
    }
    if (app) await bounded(app.close(), 5000);
    if (telemetry) await bounded(telemetry.shutdown(), 5000);
    if (receiver) await receiver.close();
    if (oidcIssuer) await oidcIssuer.close();
    if (issuer?.listening) {
      issuer.closeAllConnections();
      await bounded(new Promise((resolve) => issuer.close(resolve)), 1000);
    }
    if (reservation?.listening) await bounded(new Promise((resolve) => reservation.close(resolve)), 1000);
  } catch {
    console.error('Integration cleanup failed within its deadline');
    process.exit(1);
  }
  process.removeListener('SIGTERM', onSignal);
  process.removeListener('SIGINT', onSignal);
}
process.exitCode = interrupted ? 143 : result;
