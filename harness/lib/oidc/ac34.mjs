// AC-34: cookie hardening under HTTPS and session rotation. env: SPKI, WEB (https origin), NS
import { writeFileSync } from 'node:fs';
import { Asserts, env, OUT, chromium, kcLogin, sha, rcli } from './lib.mjs';
const A = new Asserts('AC-34');
const BASE = env.WEB, NS = env.NS;
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP app.acme.test 127.0.0.1, MAP id.acme.test 127.0.0.1', '--ignore-certificate-errors-spki-list=' + env.SPKI] });
const ctx = await browser.newContext({ recordVideo: { dir: OUT + '/video' } }); await ctx.tracing.start({ screenshots: true, snapshots: true });
const page = await ctx.newPage(); const setCookies = [];
page.on('response', async (r) => { if (!r.url().startsWith(BASE)) return; for (const h of (await r.headersArray()).filter((x) => x.name.toLowerCase() === 'set-cookie')) setCookies.push({ url: r.url().replace(/\?.*/, ''), status: r.status(), raw: h.value.replace(/^([^=]+)=([^;]*)/, (m, n, v) => n + '=<' + v.length + ' chars>') }); });
const has = (id) => rcli(6379, 'EXISTS', `${NS}:session:${sha(id)}`) === '1';
const PRESET = 'A'.repeat(43);
try {
  await ctx.addCookies([{ name: '__Host-app_session', value: PRESET, url: BASE + '/', secure: true, httpOnly: false, sameSite: 'Lax' }]);
  await page.goto(BASE + '/projects');
  A.check('pre-set cookie value is not a server session and does not grant access', !has(PRESET) && !(await page.locator('a[href^="/projects/"]').count()) && (await page.locator('h1').first().textContent()) !== 'Projects' || /8443\/realms|sign|login/i.test(page.url()), { url: page.url().replace(/\?.*/, '') });
  const signIn = async () => { await page.goto(BASE + '/auth/login'); if (page.url().includes('id.acme.test')) await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects'); };
  const sid = async () => (await ctx.cookies(BASE)).find((c) => c.name === '__Host-app_session');
  await signIn(); const id1 = await sid();
  A.check('signed-in session id differs from the pre-set value and exists server-side', id1.value !== PRESET && has(id1.value) && !has(PRESET));
  await page.screenshot({ path: OUT + '/signed-in-https.png' });
  await Promise.all([page.waitForURL(BASE + '/signed-out'), page.getByRole('button', { name: 'Sign out' }).click()]);
  A.check('sign-out deletes the first session server-side', !has(id1.value));
  await signIn(); const id2 = await sid();
  A.check('second sign-in issues a new session id', id2.value !== id1.value && has(id2.value));
  await signIn(); const id3 = await sid();
  A.check('re-login without sign-out issues a new id and removes the old session', id3.value !== id2.value && has(id3.value) && !has(id2.value));
  await ctx.addCookies([{ name: '__Host-app_session', value: PRESET, url: BASE + '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  // The server must refuse the pre-set value outright: the request carrying it is sent to sign-in, never served.
  const direct = await ctx.request.get(BASE + '/projects', { maxRedirects: 0 });
  const refused = direct.status() === 307 && /\/auth\/login/.test(direct.headers().location || '');
  await page.goto(BASE + '/projects');
  // Sign-in then either stops at the provider's login page, or (the provider's single sign-on session is still live,
  // because same-account re-login keeps it) completes at once and issues a brand-new server-side session id.
  const after = await sid();
  const reissued = !!after && after.value !== PRESET && after.value !== id3.value && has(after.value);
  const stopped = /8443\/realms|login/i.test(page.url()) || (!(await page.locator('a[href^="/projects/"]').count()) && (await page.locator('h1').first().textContent()) !== 'Projects');
  A.check('replacing the cookie with a pre-set value while signed in grants nothing (refused with a sign-in redirect; any access afterwards is a new server-issued session)', !has(PRESET) && refused && (stopped || reissued), { directStatus: direct.status(), directToLogin: refused, stoppedAtSignIn: stopped, newSessionIssued: reissued });
  A.check('document.cookie exposes no session cookie', !/app_session/.test(await page.evaluate(() => document.cookie)));
} catch (e) { A.check('script completed without exception', false, String(e.stack || e).slice(0, 400)); }
await ctx.tracing.stop({ path: OUT + '/trace.zip' }).catch(() => {});
await browser.close();
const parsed = setCookies.map((s) => { const c = s.raw, name = c.split('=')[0]; return { ...s, name, hostPrefix: name.startsWith('__Host-'), secure: /;\s*secure/i.test(c), httpOnly: /;\s*httponly/i.test(c), sameSite: (c.match(/;\s*samesite=(\w+)/i) || [])[1], pathRoot: /;\s*path=\/(;|$)/i.test(c), domain: /;\s*domain=/i.test(c) }; });
writeFileSync(OUT + '/set-cookie.json', JSON.stringify(parsed, null, 1));
A.check('the flow produced Set-Cookie headers on the app origin', parsed.length > 0, { n: parsed.length });
for (const v of parsed) A.check(`Set-Cookie ${v.name} (${v.status} ${v.url.replace(BASE, '')}): __Host-, Secure, HttpOnly, SameSite Lax/Strict, Path=/, no Domain`, v.hostPrefix && v.secure && v.httpOnly && /^(lax|strict)$/i.test(v.sameSite || '') && v.pathRoot && !v.domain, { raw: v.raw });
A.finish();
