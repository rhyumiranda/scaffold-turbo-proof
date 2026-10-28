// AC-89: observe the documented incident symptoms on the container stack and assert them.
// Env: WS, OUT, SCENARIO = db | redis | limiter | idp. Needs KC_USER_PASSWORD, KC_ACME_CLI_SECRET in the environment.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
const req = createRequire(process.env.WS + '/apps/web/package.json');
const { chromium } = req('@playwright/test');
const { OUT, SCENARIO: sc } = process.env;
mkdirSync(OUT, { recursive: true });
const BASE = 'https://app.acme.test:8443', API = 'http://127.0.0.1:4100', WEB = 'http://127.0.0.1:3000';
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(); const log = []; const checks = {};
const note = (k, v) => { const e = { t: ((Date.now() - t0) / 1000).toFixed(1), k, v }; log.push(e); console.log(JSON.stringify(e)); };
const check = (name, ok) => { checks[name] = !!ok; note('CHECK ' + name, !!ok); };
const status = async (url, init) => { try { const r = await fetch(url, init); return { s: r.status, ra: r.headers.get('retry-after'), ct: r.headers.get('content-type') || '', b: (await r.text()).slice(0, 200) }; } catch (e) { return { s: 'ERR ' + (e.cause?.code || e.message) }; } };
async function mint() {
  const r = await fetch('http://127.0.0.1:18080/realms/acme/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'acme-cli', client_secret: process.env.KC_ACME_CLI_SECRET, username: 'alice', password: process.env.KC_USER_PASSWORD, scope: 'openid' }) });
  return (await r.json()).access_token;
}
const pid = (c) => sh(`docker inspect -f '{{.State.Pid}} {{.State.StartedAt}}' ${c}`);
async function waitFor(fn, pred, ms) { const s = Date.now(); let v; while (Date.now() - s < ms) { v = await fn(); if (pred(v)) return { v, secs: ((Date.now() - s) / 1000).toFixed(1), ok: true }; await sleep(500); } return { v, secs: 'timeout', ok: false }; }
const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
async function login(p) {
  for (let a = 0; a < 4; a++) { try { await p.goto(BASE + '/projects'); break; } catch (e) { if (a === 3) throw e; await sleep(2000); } } await p.waitForSelector('#username', { timeout: 30000 });
  await p.fill('#username', 'alice'); await p.fill('#password', process.env.KC_USER_PASSWORD);
  await Promise.all([p.waitForURL(BASE + '/projects', { timeout: 30000 }), p.click('#kc-login')]);
}
const h1 = async (p) => (await p.locator('h1').first().textContent({ timeout: 5000 }).catch(() => null));
const auth = (t) => ({ headers: { authorization: 'Bearer ' + t } });
const result = { scenario: sc };
try {
  await login(page); note('logged in', page.url());
  const token = await mint();
  const apiBefore = pid('acc-api'), webBefore = pid('acc-web');
  if (sc === 'db') {
    sh('docker stop acc-pg');
    const ready = await waitFor(() => status(API + '/health/ready'), (x) => x.s === 503, 40000);
    check('db down: /health/ready 503 within seconds', ready.ok && Number(ready.secs) < 40);
    check('db down: /health/live stays 200', (await status(API + '/health/live')).s === 200);
    const pr = await status(API + '/v1/projects?limit=20', auth(token));
    note('GET /v1/projects', pr);
    check('db down: API answers 503 problem+json with Retry-After', pr.s === 503 && /problem\+json/.test(pr.ct) && !!pr.ra);
    await page.reload(); await page.waitForLoadState('load');
    const body = await page.locator('body').innerText();
    check('db down: web shows "Projects unavailable"', /Projects unavailable/i.test(body));
    check('db down: web has a Try again button', (await page.getByRole('button', { name: 'Try again' }).count()) > 0);
    await page.screenshot({ path: OUT + '/db-down.png' });
    check('db down: web /healthz stays 200', (await status(WEB + '/healthz')).s === 200);
    check('db down: database.query_failure logged', Number(sh("docker logs acc-api 2>&1 | grep -c database.query_failure || true")) > 0);
    sh('docker start acc-pg');
    const back = await waitFor(() => status(API + '/health/ready'), (x) => x.s === 200, 90000);
    check('db down: readiness returns to 200 automatically', back.ok);
    check('db down: API process not restarted', pid('acc-api') === apiBefore);
    await page.getByRole('button', { name: 'Try again' }).click().catch(() => {});
    const listed = await page.getByRole('button', { name: 'Create project' }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
    check('db down: Try again recovers the list', listed);
  } else if (sc === 'redis') {
    sh('docker stop acc-redis');
    const r1 = await page.goto(BASE + '/projects').catch(() => null);
    const okPage = r1 && r1.status() === 200 && (await h1(page)) === 'Projects';
    check('session Redis down: signed-in page fails', !okPage);
    await page.screenshot({ path: OUT + '/redis-down-signed-in.png' });
    const c2 = await browser.newContext({ ignoreHTTPSErrors: true }); const p2 = await c2.newPage();
    await p2.goto(BASE + '/auth/login?returnTo=%2Fprojects').catch(() => null);
    const formShown = await p2.locator('#username').count();
    check('session Redis down: new sign-in fails (no login form)', formShown === 0);
    check('session Redis down: web /healthz stays 200', (await status(WEB + '/healthz')).s === 200);
    await sleep(2000);
    check('session Redis down: web logs framework.log errors', Number(sh("docker logs acc-web 2>&1 | grep framework.log | grep -c '\"level\":\"error\"' || true")) > 0);
    sh('docker start acc-redis');
    const back = await waitFor(async () => { const r = await page.goto(BASE + '/projects').catch(() => null); return { s: r && r.status(), h: await h1(page) }; }, (x) => x.s === 200 && x.h === 'Projects', 90000);
    check('session Redis down: signed-in page works again automatically', back.ok);
    check('session Redis down: web process not restarted', pid('acc-web') === webBefore);
  } else if (sc === 'limiter') {
    // API was started with LIMITER_MODE=redis by the caller.
    const ok0 = await status(API + '/v1/projects?limit=20', auth(token));
    check('limiter Redis: baseline request 200', ok0.s === 200);
    sh('docker stop acc-redis');
    await sleep(2000);
    const ready = await waitFor(() => status(API + '/health/ready'), (x) => x.s === 503, 40000);
    check('limiter Redis down: /health/ready 503', ready.ok);
    const pr = await status(API + '/v1/projects?limit=20', auth(token));
    check('limiter Redis down: requests fail closed with 503', pr.s === 503);
    check('limiter Redis down: /health/live stays 200', (await status(API + '/health/live')).s === 200);
    sh('docker start acc-redis');
    const back = await waitFor(() => status(API + '/health/ready'), (x) => x.s === 200, 90000);
    check('limiter Redis down: recovers automatically', back.ok);
    check('limiter Redis down: API process not restarted', pid('acc-api') === apiBefore);
  } else if (sc === 'idp') {
    sh('docker stop acc-kc');
    await sleep(1000);
    const r1 = await page.goto(BASE + '/projects');
    check('IdP down: existing session keeps working', r1.status() === 200 && (await h1(page)) === 'Projects');
    check('IdP down: API accepts a valid token with cached keys', (await status(API + '/v1/projects?limit=20', auth(token))).s === 200);
    await sleep(7000); // the web app re-checks the provider at most every 5 s
    const c2 = await browser.newContext({ ignoreHTTPSErrors: true }); const p2 = await c2.newPage();
    await p2.goto(BASE + '/projects').catch(() => null); await p2.waitForLoadState('load').catch(() => {});
    note('new sign-in url', p2.url().replace(/(state|nonce|code_challenge)=[^&]+/g, '$1=<r>'));
    check('IdP down: new sign-ins land on /sign-in-problem?reason=unavailable', /\/sign-in-problem\?reason=unavailable/.test(p2.url()));
    await p2.screenshot({ path: OUT + '/idp-down-new-signin.png' });
    sh('docker start acc-kc');
    const back = await waitFor(async () => { const c3 = await browser.newContext({ ignoreHTTPSErrors: true }); const p3 = await c3.newPage(); try { await login(p3); return true; } catch { return false; } finally { await c3.close(); } }, (x) => x === true, 240000);
    check('IdP down: fresh sign-in works again automatically', back.ok);
    check('IdP down: web and API processes not restarted', pid('acc-api') === apiBefore && pid('acc-web') === webBefore);
  }
} catch (e) { result.error = String(e.stack || e).slice(0, 1500); note('ERROR', result.error); checks['no script error'] = false; }
finally {
  await browser.close();
  result.log = log; result.checks = checks;
  writeFileSync(OUT + '/result.json', JSON.stringify(result, null, 1));
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  console.log('FAILED CHECKS', JSON.stringify(failed));
  process.exit(failed.length || !Object.keys(checks).length ? 1 : 0);
}
