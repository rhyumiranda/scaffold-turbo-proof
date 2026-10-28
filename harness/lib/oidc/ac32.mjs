// AC-32: real OIDC sign-in through Keycloak's login page, create "Alpha", reload, token isolation.
import { writeFileSync, readFileSync } from 'node:fs';
import { Asserts, env, OUT, chromium, kcLogin, attachRecorder, redisSession, JWT, sql, mint, decode } from './lib.mjs';
const A = new Asserts('AC-32');
const BASE = env.WEB, sink = { console: [], requests: [], responses: [] };
const browser = await chromium.launch();
const context = await browser.newContext({ recordVideo: { dir: OUT + '/video' } });
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage(); attachRecorder(page, sink);
const r = {};
try {
  await page.goto(BASE + '/projects');
  if (!page.url().startsWith('http://localhost:8080')) await Promise.all([page.waitForURL(/localhost:8080\/realms\/.*\/protocol\/openid-connect\/auth/, { timeout: 20000 }), page.getByRole('link', { name: 'Sign in' }).click()]);
  const auth = sink.requests.find((q) => /\/protocol\/openid-connect\/auth\?/.test(q.url));
  const u = new URL(auth.url);
  A.check('redirected to Keycloak authorization endpoint of realm acme', u.origin === 'http://localhost:8080' && u.pathname === '/realms/acme/protocol/openid-connect/auth', { origin: u.origin, path: u.pathname });
  A.check('authorization request uses code_challenge_method=S256 with code_challenge', u.searchParams.get('code_challenge_method') === 'S256' && !!u.searchParams.get('code_challenge'));
  A.check('authorization request carries state and nonce', !!u.searchParams.get('state') && !!u.searchParams.get('nonce'));
  A.check('response_type=code (authorization code flow)', u.searchParams.get('response_type') === 'code');
  await page.screenshot({ path: OUT + '/01-keycloak-login.png' });
  await kcLogin(page, 'alice', env.ALICE_PASSWORD);
  await page.waitForURL(BASE + '/projects', { timeout: 20000 });
  A.check('returned to the app at /projects', page.url() === BASE + '/projects');
  await page.getByLabel('Project name').fill('Alpha');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor({ timeout: 15000 });
  await page.reload();
  await page.getByRole('link', { name: 'Alpha', exact: true }).first().waitFor({ timeout: 15000 });
  A.check('"Alpha" visible after reload', true);
  await page.screenshot({ path: OUT + '/03-after-reload.png' });
  const docCookie = await page.evaluate(() => document.cookie);
  const ls = await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  const ss = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
  const cookies = await context.cookies();
  const sess = cookies.find((c) => c.name === 'app_session');
  A.check('session cookie app_session is HttpOnly', !!sess && sess.httpOnly === true, sess && { httpOnly: sess.httpOnly, sameSite: sess.sameSite, path: sess.path });
  A.check('session cookie is not readable from document.cookie', !/app_session/.test(docCookie));
  const session = await redisSession(6379, env.NS, sess.value);
  A.check('server-side session holds the access token', !!session?.accessToken);
  const tokens = [session?.accessToken, session?.refreshToken].filter(Boolean);
  const blobs = [docCookie, ls, ss, ...sink.responses.map((x) => JSON.stringify(x.headers) + (x.body ?? '')), ...sink.requests.map((x) => x.url + JSON.stringify(x.headers))];
  A.check('access/refresh tokens never appear in cookies, storage, requests or JS-visible responses', !tokens.some((t) => blobs.some((b) => b.includes(t) || b.includes(t.slice(-40)))));
  A.check('no JWT in any response from the app origin', !sink.responses.filter((x) => x.url.startsWith(BASE)).some((x) => JWT.test(JSON.stringify(x.headers) + (x.body ?? ''))));
  const csp = sink.console.filter((m) => /Content Security Policy|Content-Security-Policy/i.test(m.text));
  A.check('no CSP violations in the browser console during the journey', csp.length === 0, csp.slice(0, 3));
  const sub = decode(await mint({ user: 'alice' })).sub;
  const owner = sql(env.DB, "SELECT owner_id FROM projects WHERE name='Alpha' ORDER BY created_at DESC LIMIT 1");
  A.check("Alpha is owned by alice's Keycloak sub (API authorised with the Keycloak access token)", owner === sub, { ownerMatches: owner === sub });
  const apilog = readFileSync(env.API_LOG, 'utf8').split('\n').filter((l) => /"route":"\/v1\/projects"/.test(l) && /"method":"POST"/.test(l) && /"status":201/.test(l));
  A.check('API log shows POST /v1/projects 201', apilog.length > 0, { lines: apilog.length });
  A.note('apiLogHasSubField', apilog.some((l) => l.includes(sub)));
} catch (e) { A.check('journey completed without exception', false, String(e.stack || e).slice(0, 400)); await page.screenshot({ path: OUT + '/error.png' }).catch(() => {}); }
finally {
  await context.tracing.stop({ path: OUT + '/trace.zip' }); await context.close(); await browser.close();
  writeFileSync(OUT + '/console.json', JSON.stringify(sink.console, null, 1));
}
A.finish();
