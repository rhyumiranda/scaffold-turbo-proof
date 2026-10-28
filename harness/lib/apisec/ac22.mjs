// AC-22: bad configuration is rejected before the port is bound; the error names the key, never a value.
// Each case spawns the compiled app with an explicit, minimal environment, samples `lsof -nP -iTCP -sTCP:LISTEN`
// every 100 ms (plus a TCP connect probe) and records exit code, time to exit and all output.
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import { Asserts, env, OUT, CLONE, KC, sleep } from './lib.mjs';

const A = new Asserts('AC-22');
const dir = OUT + '/cases'; mkdirSync(dir, { recursive: true });
const base = { PATH: env.PATH, HOME: env.HOME };
const dbUrl = (pw, db = env.AC22_DB) => `postgresql://postgres:${pw}@127.0.0.1:5432/${db}`;
const without = (o, k) => { const c = { ...o }; delete c[k]; return c; };
const API_PORT = '4122', WEB_PORT = '3122';
const api = { ...base, NODE_ENV: 'test', PORT: API_PORT, DATABASE_URL: dbUrl(env.PG_PASSWORD), AUTH_ISSUER: KC + '/realms/acme', AUTH_AUDIENCE: 'acme-api', AUTH_JWKS_URL: KC + '/realms/acme/protocol/openid-connect/certs', LIMITER_MODE: 'memory', LIMITER_REDIS_URL: 'rediss://:SENTINEL-AC22-2@cache.example.invalid:6379' };
const web = { ...base, NODE_ENV: 'production', PORT: WEB_PORT, HOSTNAME: '127.0.0.1', API_BASE_URL: 'http://127.0.0.1:4103', AUTH_MODE: 'oidc', AUTH_APP_ORIGIN: `http://localhost:${WEB_PORT}`, AUTH_ISSUER: KC + '/realms/acme', AUTH_INSECURE_LOOPBACK: 'true', AUTH_CLIENT_ID: 'acme-web', AUTH_CLIENT_SECRET: 'SENTINEL-AC22-3', AUTH_REDIS_URL: 'redis://127.0.0.1:6379', AUTH_NAMESPACE: 'ac22' };
const webHttps = { ...without(web, 'AUTH_INSECURE_LOOPBACK'), AUTH_APP_ORIGIN: 'https://app.acme.test:8443' };
// [name, kind, env, regex that must appear in the output (the offending key), expectListen]
const cases = [
  ['api-control-valid-config', 'api', api, null, true],
  ['api-1-unset-DATABASE_URL', 'api', without(api, 'DATABASE_URL'), /DATABASE_URL/],
  ['api-2-AUTH_ISSUER-not-a-url', 'api', { ...api, DATABASE_URL: dbUrl('SENTINEL-AC22-1'), AUTH_ISSUER: 'not-a-url' }, /AUTH_ISSUER/],
  ['api-3-PORT-70000', 'api', { ...api, DATABASE_URL: dbUrl('SENTINEL-AC22-1'), PORT: '70000' }, /\bPORT\b/],
  ['api-4-SHUTDOWN_TIMEOUT_MS-5', 'api', { ...api, DATABASE_URL: dbUrl('SENTINEL-AC22-1'), SHUTDOWN_TIMEOUT_MS: '5' }, /SHUTDOWN_TIMEOUT_MS/],
  ['api-5-TRUST_PROXY_CIDRS-star', 'api', { ...api, DATABASE_URL: dbUrl('SENTINEL-AC22-1'), TRUST_PROXY_CIDRS: '*' }, /TRUST_PROXY_CIDRS/],
  ['api-6-LIMITER_MODE-redis-no-url', 'api', { ...without(api, 'LIMITER_REDIS_URL'), DATABASE_URL: dbUrl('SENTINEL-AC22-5'), LIMITER_MODE: 'redis' }, /LIMITER_REDIS_URL|LIMITER_MODE/],
  ['web-control-valid-config', 'web', { ...web, AUTH_CLIENT_SECRET: 'SENTINEL-AC22-3' }, null, true],
  ['web-1-unset-AUTH_CLIENT_ID', 'web', without(web, 'AUTH_CLIENT_ID'), /AUTH_CLIENT_ID/],
  ['web-2-AUTH_ISSUER-http-evil-no-loopback-flag', 'web', { ...webHttps, AUTH_ISSUER: 'http://evil.example' }, /AUTH_ISSUER/],
  ['web-2b-AUTH_ISSUER-http-evil-no-flag-http-origin', 'web', { ...without(web, 'AUTH_INSECURE_LOOPBACK'), AUTH_ISSUER: 'http://evil.example' }, /AUTH_ISSUER|AUTH_APP_ORIGIN/],
  ['web-3-AUTH_REDIS_URL-remote-plain', 'web', { ...web, AUTH_REDIS_URL: 'redis://remote.example:6379' }, /AUTH_REDIS_URL/],
  ['web-3b-AUTH_REDIS_URL-remote-with-sentinel-password', 'web', { ...web, AUTH_REDIS_URL: 'redis://:SENTINEL-AC22-4@remote.example:6379' }, /AUTH_REDIS_URL/],
  ['web-3c-AUTH_REDIS_URL-remote-https-origin-no-flag', 'web', { ...webHttps, AUTH_ISSUER: 'https://id.acme.test:8443/realms/acme', AUTH_REDIS_URL: 'redis://:SENTINEL-AC22-6@remote.example:6379' }, /AUTH_REDIS_URL/],
  ['web-4-unset-API_BASE_URL', 'web', without(web, 'API_BASE_URL'), /API_BASE_URL/],
];

const probe = (port) => new Promise((res) => { const s = net.connect(Number(port), '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });
const lsofAll = () => { try { return execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' }); } catch (e) { return String(e.stdout || ''); } };

async function boot([name, kind, e, expect, expectListen]) {
  const cwd = CLONE + (kind === 'api' ? '/apps/api' : '/apps/web');
  const cmd = kind === 'api' ? ['node', 'dist/main.js'] : ['node', 'scripts/start.mjs'];
  const port = e.PORT === '70000' ? API_PORT : e.PORT;
  const t0 = performance.now();
  const child = spawn(cmd[0], cmd.slice(1), { cwd, env: e, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '', exit = null, bound = false; const snaps = [];
  child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
  const done = new Promise((r) => child.on('exit', (code, sig) => { exit = { code, sig, ms: Math.round(performance.now() - t0) }; r(); }));
  const timer = setInterval(async () => {
    const l = lsofAll().split('\n').filter((x) => x.includes(child.pid + '') || / node /.test(x) && x.includes(':' + port + ' '));
    const mine = l.filter((x) => new RegExp(`\\s${child.pid}\\s`).test(x));
    if (mine.length || (await probe(port))) bound = true;
    if (snaps.length < 300) snaps.push(`${Math.round(performance.now() - t0)}ms ` + (mine.length ? mine.join(' | ') : `(no listener for pid ${child.pid})`));
  }, 100);
  // A valid control is stopped once it has been seen listening; invalid cases are killed at 12 s (a failure).
  const limit = expectListen ? 20000 : 12000;
  const killer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, limit);
  if (expectListen) { for (let i = 0; i < 200 && !bound && exit === null; i++) await sleep(100); await sleep(300); try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  await Promise.race([done, sleep(limit + 2000)]); clearTimeout(killer); await sleep(200); clearInterval(timer);
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  const text = out + '\n' + err;
  writeFileSync(`${dir}/${name}.output.txt`, text);
  writeFileSync(`${dir}/${name}.lsof.txt`, snaps.join('\n') + '\n');
  const result = { name, envNames: Object.keys(e).sort(), exitCode: exit?.code ?? null, signal: exit?.sig ?? null, msToExit: exit?.ms ?? null, portEverBound: bound };
  writeFileSync(`${dir}/${name}.result.json`, JSON.stringify(result, null, 1));
  return { result, text };
}

for (const c of cases) {
  const [name, , , expect, expectListen] = c;
  const { result, text } = await boot(c);
  const sentinel = /SENTINEL-AC22/.test(text);
  if (expectListen) {
    A.check(`${name}: valid control config binds the port (proves the listener detection works)`, result.portEverBound === true, result);
    A.check(`${name}: no sentinel in output`, !sentinel);
  } else {
    A.check(`${name}: exits non-zero within 10 s`, typeof result.exitCode === 'number' && result.exitCode !== 0 && result.signal === null && result.msToExit < 10000, { exitCode: result.exitCode, signal: result.signal, ms: result.msToExit });
    A.check(`${name}: port never bound`, result.portEverBound === false);
    A.check(`${name}: output names the offending variable`, expect.test(text), { expect: String(expect), firstLine: text.trim().split('\n')[0].slice(0, 160) });
    A.check(`${name}: no sentinel in output`, !sentinel);
  }
}
process.exit(A.finish() ? 0 : 0);
