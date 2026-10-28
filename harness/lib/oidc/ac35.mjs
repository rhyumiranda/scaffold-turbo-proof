// AC-35: sign-out and expiry end access on the server. Web runs with AUTH_SESSION_SECONDS=60, Keycloak access token 60 s.
import { readFileSync, writeFileSync } from 'node:fs';
import { Asserts, env, OUT, chromium, kcLogin, sha, rcli, sql, sleep, decode } from './lib.mjs';
const A = new Asserts('AC-35');
const BASE = env.WEB, NS = env.NS, API = env.API;
const scan = () => rcli(6379, '--scan', '--pattern', NS + ':*').split('\n').filter(Boolean);
const rows = [];
async function raw(label, method, path, cookie, headers = {}) {
  const r = await fetch(BASE + path, { method, redirect: 'manual', headers: { ...(cookie ? { cookie: 'app_session=' + cookie } : {}), ...headers } });
  const t = await r.text();
  const o = { label, status: r.status, location: r.headers.get('location'), h1: (t.match(/<h1>([^<]*)<\/h1>/) || [])[1], hasProjectLinks: /href="\/projects\/[0-9a-f-]{36}"/.test(t), actionResult: (t.match(/\{"status":"(?:error|success)"[^}]*\}/) || [null])[0], body: t.slice(0, 160) };
  rows.push(o); return o;
}
const browser = await chromium.launch();
const ctx = await browser.newContext({ recordVideo: { dir: OUT + '/video' } }); await ctx.tracing.start({ screenshots: true, snapshots: true });
const page = await ctx.newPage();
try {
  await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
  await page.getByLabel('Project name').fill('AC35-seed'); await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
  let cap; page.on('request', async (r) => { if (r.method() === 'POST' && r.headers()['next-action'] && !cap) cap = { url: r.url(), headers: await r.allHeaders(), body: r.postDataBuffer() }; });
  await page.getByLabel('Project name').fill('AC35-capture'); await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
  const cookie = (await ctx.cookies()).find((c) => c.name === 'app_session').value;
  const key = `${NS}:session:${sha(cookie)}`;
  A.check('server-side session key exists after sign-in', scan().includes(key));
  const g = await raw('GET /auth/logout', 'GET', '/auth/logout', cookie);
  const x = await raw('POST /auth/logout Origin evil', 'POST', '/auth/logout', cookie, { origin: 'https://evil.example' });
  const n = await raw('POST /auth/logout no Origin', 'POST', '/auth/logout', cookie);
  A.check('GET /auth/logout returns 405', g.status === 405, { status: g.status });
  A.check('cross-origin POST /auth/logout returns 403', x.status === 403, { status: x.status });
  A.check('POST /auth/logout without Origin returns 403', n.status === 403, { status: n.status });
  const still = await raw('GET /projects after refused logouts', 'GET', '/projects', cookie);
  A.check('session still valid after GET and cross-origin logout attempts', scan().includes(key) && still.status === 200 && still.h1 === 'Projects', { status: still.status, h1: still.h1 });
  await page.goto(BASE + '/projects');
  await Promise.all([page.waitForURL(BASE + '/signed-out'), page.getByRole('button', { name: 'Sign out' }).click()]);
  await page.screenshot({ path: OUT + '/signed-out.png' });
  A.check('UI sign-out deletes the Redis session key', !scan().includes(key));
  A.check('UI sign-out clears the browser cookie', (await ctx.cookies()).filter((c) => c.name === 'app_session').length === 0);
  const replay = await raw('replay old cookie GET /projects', 'GET', '/projects', cookie);
  A.check('replayed old cookie is redirected to sign-in with no data', replay.status >= 300 && replay.status < 400 && /\/auth\/login|sign-in/.test(replay.location || '') && !replay.hasProjectLinks, { status: replay.status, location: replay.location });
  const before = sql(env.DB, "SELECT count(*) FROM projects WHERE name='AC35-replay-after-logout'");
  const hdrs = Object.fromEntries(Object.entries(cap.headers).filter(([k]) => !['cookie', 'content-length', 'host'].includes(k)));
  const rr = await fetch(cap.url, { method: 'POST', headers: { ...hdrs, cookie: 'app_session=' + cookie }, body: Buffer.from(cap.body.toString('latin1').replace('AC35-capture', 'AC35-replay-after-logout'), 'latin1'), redirect: 'manual' });
  const rt = await rr.text(); const after = sql(env.DB, "SELECT count(*) FROM projects WHERE name='AC35-replay-after-logout'");
  rows.push({ label: 'replay Server Action with old cookie', status: rr.status, result: (rt.match(/\{"status":"(?:error|success)"[^}]*\}/) || [null])[0] });
  A.check('replayed Server Action with the old cookie is refused and writes nothing', before === after && after === '0' && !/"status":"success"/.test(rt) && rr.status < 500, { status: rr.status, before, after });
  // expiry
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/auth/login'); await kcLogin(p2, 'alice', env.ALICE_PASSWORD); await p2.waitForURL(BASE + '/projects');
  const c2 = (await ctx2.cookies()).find((c) => c.name === 'app_session').value; const k2 = `${NS}:session:${sha(c2)}`;
  const sess = JSON.parse(rcli(6379, 'GET', k2)); const tok = sess.accessToken;
  A.note('freshSessionTtl', rcli(6379, 'TTL', k2));
  await sleep(75000);
  await p2.goto(BASE + '/projects'); await p2.screenshot({ path: OUT + '/expired-session.png' });
  A.check('after 75 s the browser is sent to sign-in, no project data', !(await p2.locator('a[href^="/projects/"]').count()) && /auth\/login|8080\/realms|sign/i.test(p2.url() + (await p2.locator('h1').first().textContent().catch(() => ''))), { url: p2.url().replace(/\?.*/, '') });
  A.check('expired session key is gone from Redis', !scan().includes(k2));
  const e = await raw('after 75 s curl /projects with the cookie', 'GET', '/projects', c2);
  A.check('after 75 s the old cookie gets a sign-in redirect', e.status >= 300 && e.status < 400 && !e.hasProjectLinks, { status: e.status });
  const api = await fetch(API + '/v1/projects', { headers: { authorization: 'Bearer ' + tok } });
  const ct = api.headers.get('content-type') || '';
  A.check('the expired access token is refused by the API with 401 problem+json', api.status === 401 && /problem\+json/.test(ct), { status: api.status, exp: new Date(decode(tok).exp * 1000).toISOString() });
  const docs = readFileSync(env.DOCS, 'utf8');
  A.check('docs state that logout is application-only (IdP end-session not implemented)', /not guaranteed provider-wide|application logout/i.test(docs));
} catch (e) { A.check('script completed without exception', false, String(e.stack || e).slice(0, 400)); }
await ctx.tracing.stop({ path: OUT + '/trace.zip' }).catch(() => {});
await browser.close();
writeFileSync(OUT + '/rows.json', JSON.stringify(rows, null, 1));
A.finish();
