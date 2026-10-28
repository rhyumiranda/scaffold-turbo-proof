// AC-33: callback abuse and open-redirect attempts fail safely.
import { writeFileSync } from 'node:fs';
import { Asserts, env, OUT, chromium, kcLogin } from './lib.mjs';
const A = new Asserts('AC-33');
const BASE = env.WEB, TX = 'oidc_transaction', SESS = 'app_session';
const transcript = [];
const red = (u) => String(u).replace(/(code|state|session_state|iss)=[^&]+/g, '$1=<r>');
async function call(label, url, cookie) {
  const r = await fetch(url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const body = await r.text(); const sc = r.headers.getSetCookie();
  const loc = r.headers.get('location') ?? '';
  const e = { label, status: r.status, location: red(loc), sessionIssued: sc.some((c) => c.startsWith(SESS + '=') && !/Max-Age=0/i.test(c) && !c.startsWith(SESS + '=;')), hasStack: /\n\s+at |Error:|node_modules/.test(body) };
  if (r.status >= 300 && r.status < 400 && loc && !loc.includes('localhost:8080')) {
    const f = await fetch(new URL(loc, BASE), { redirect: 'manual' }); const fb = await f.text();
    e.followed = { url: new URL(loc, BASE).origin + new URL(loc, BASE).pathname, status: f.status, hasStack: /\n\s+at |node_modules|webpack-internal/.test(fb) };
  }
  transcript.push(e); return e;
}
const safe = (e) => !e.sessionIssued && e.status < 500 && !e.hasStack && (!e.location || new URL(e.location, BASE).origin === BASE) && (!e.followed || (e.followed.status < 500 && !e.followed.hasStack));
const browser = await chromium.launch();
async function capture(loginPath = '/auth/login') {
  const ctx = await browser.newContext(); const page = await ctx.newPage(); let cb;
  await page.route(/\/login-actions\/authenticate/, async (route) => { const resp = await route.fetch({ maxRedirects: 0 }); const loc = resp.headers()['location']; if (loc && loc.startsWith(BASE + '/auth/callback')) { cb = loc; await route.fulfill({ status: 200, contentType: 'text/plain', body: 'captured' }); } else await route.fulfill({ response: resp }); });
  await page.goto(BASE + loginPath); await kcLogin(page, 'alice', env.ALICE_PASSWORD).catch(() => {});
  for (let i = 0; i < 50 && !cb; i++) await page.waitForTimeout(100);
  const tx = (await ctx.cookies()).find((c) => c.name === TX)?.value; await ctx.close(); return { cb, tx };
}
try {
  { const { cb, tx } = await capture(); A.check('captured a real callback URL and transaction cookie', !!cb && !!tx);
    const u = new URL(cb); u.searchParams.set('state', 'tampered' + u.searchParams.get('state').slice(8));
    A.check('(a) tampered state: no session, safe redirect', safe(await call('a tampered state', u.href, `${TX}=${tx}`)));
    A.check('(a2) original callback after the tampered attempt: no session', safe(await call('a2 original after tamper', cb, `${TX}=${tx}`))); }
  { const { cb, tx } = await capture(); const ok = await call('b0 legitimate callback (control)', cb, `${TX}=${tx}`);
    A.check('(b0) control: a legitimate callback does create a session', ok.sessionIssued === true);
    A.check('(b1) replayed code with same transaction cookie: no session', safe(await call('b1 replay same code', cb, `${TX}=${tx}`)));
    const fresh = await capture();
    A.check('(b2) old code with a fresh transaction cookie: no session', safe(await call('b2 old code fresh tx', cb, `${TX}=${fresh.tx}`)));
    const u = new URL(fresh.cb); u.searchParams.set('code', new URL(cb).searchParams.get('code'));
    A.check('(b3) old code with fresh state and fresh cookie: no session', safe(await call('b3 old code fresh state', u.href, `${TX}=${fresh.tx}`))); }
  { const { cb } = await capture(); A.check('(c) valid code+state without the transaction cookie: no session', safe(await call('c no tx cookie', cb, ''))); }
  { const { cb, tx } = await capture(); const st = new URL(cb).searchParams.get('state');
    A.check('(d1) error=access_denied with cookie: no session, safe page', safe(await call('d1 error param', `${BASE}/auth/callback?error=access_denied&state=${st}`, `${TX}=${tx}`)));
    A.check('(d2) error=access_denied without cookie: no session, safe page', safe(await call('d2 error param no cookie', `${BASE}/auth/callback?error=access_denied`, ''))); }
  const targets = ['https://evil.example/', '//evil.example', '/\\evil.example', 'javascript:alert(1)'];
  const names = ['returnTo', 'return_to', 'next', 'redirect', 'redirectTo', 'redirect_uri', 'callbackUrl', 'continue', 'url', 'from', 'post_login_redirect_uri'];
  for (const t of targets) {
    const qs = names.map((n) => n + '=' + encodeURIComponent(t)).join('&');
    for (const path of ['/auth/login?' + qs, '/projects?' + qs]) {
      const r = await fetch(BASE + path, { redirect: 'manual' }); const lu = new URL(r.headers.get('location') ?? '/', BASE);
      const ru = lu.searchParams.get('redirect_uri');
      A.check(`(e) ${path.split('?')[0]} with every return-to param = ${t}: redirect stays on Keycloak/app and redirect_uri is the app callback`, r.status < 400 && (lu.origin === BASE || lu.origin === 'http://localhost:8080') && (!ru || ru === BASE + '/auth/callback'), { status: r.status, origin: lu.origin, redirect_uri: ru });
    }
    for (const start of ['/auth/login?' + qs, '/auth/login?returnTo=' + encodeURIComponent(t)]) {
      const ctx = await browser.newContext(); const page = await ctx.newPage();
      await page.goto(BASE + start); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForLoadState('load'); await page.waitForTimeout(800);
      const fin = page.url(); const same = fin.startsWith('http') && new URL(fin).origin === BASE;
      transcript.push({ label: 'e full sign-in ' + start.slice(0, 40) + ' ' + t, finalUrl: fin.replace(/\?.*/, '') });
      A.check(`(e) full sign-in with return-to ${t} (${start.includes('&') ? 'all names' : 'returnTo'}) lands on a same-origin path`, same, { final: fin.replace(/\?.*/, '') });
      await ctx.close();
    }
  }
} catch (e) { A.check('script completed without exception', false, String(e.stack || e).slice(0, 400)); }
await browser.close();
writeFileSync(OUT + '/transcript.json', JSON.stringify(transcript, null, 1));
A.finish();
