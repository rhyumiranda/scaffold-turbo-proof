// AC-40: security headers over HTTPS + browser journey without CSP violations. env: SPKI, WEB, API (prod API url), API_DOWN_CMD, API_UP_CMD
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Asserts, env, OUT, chromium, kcLogin, sleep } from './lib.mjs';
const A = new Asserts('AC-40');
const BASE = env.WEB;
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP app.acme.test 127.0.0.1, MAP id.acme.test 127.0.0.1', '--ignore-certificate-errors-spki-list=' + env.SPKI] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); const page = await ctx.newPage();
const consoleMsgs = []; page.on('console', (m) => consoleMsgs.push({ type: m.type(), text: m.text() }));
const cspEvents = []; await page.exposeFunction('__cspv', (v) => cspEvents.push(v));
await ctx.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => window.__cspv && window.__cspv({ directive: e.violatedDirective, blocked: e.blockedURI, doc: location.href })));
const docs = [];
page.on('response', async (r) => { if (r.request().resourceType() === 'document' && r.url().startsWith(BASE)) { const h = await r.allHeaders(); docs.push({ url: r.url().replace(/\?.*/, ''), status: r.status(), h }); } });
try {
  await page.goto(BASE + '/projects');
  await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
  await page.getByLabel('Project name').fill('AC40 journey'); await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Open created project' }).click(); await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByLabel('Project name').fill('AC40 journey renamed'); await page.getByRole('button', { name: 'Save name' }).click();
  await page.getByRole('status').filter({ hasText: 'Project renamed.' }).waitFor();
  await page.getByLabel('Project name').fill(''); await page.getByRole('button', { name: 'Save name' }).click(); await page.locator('#name-error').waitFor();
  await page.goto(BASE + '/does-not-exist');
  execSync(env.API_DOWN_CMD, { shell: '/bin/bash' });
  const er = await page.goto(BASE + '/projects'); await page.waitForTimeout(800);
  A.note('errorState', { status: er.status(), h1: await page.locator('h1').first().textContent() });
  await page.screenshot({ path: OUT + '/error-state.png' });
  execSync(env.API_UP_CMD, { shell: '/bin/bash' });
  for (let i = 0; i < 20; i++) { await sleep(2000); await page.goto(BASE + '/projects'); if ((await page.locator('h1').first().textContent()) === 'Projects') break; }
  await Promise.all([page.waitForURL(BASE + '/signed-out'), page.getByRole('button', { name: 'Sign out' }).click()]);
} catch (e) { A.check('journey completed without exception', false, String(e.stack || e).slice(0, 400)); }
await browser.close();
const csp = consoleMsgs.filter((m) => /Content Security Policy|Content-Security-Policy|Refused to/i.test(m.text));
A.check('zero CSP violations in the browser console and zero securitypolicyviolation events', csp.length === 0 && cspEvents.length === 0, { console: csp.slice(0, 3), events: cspEvents.slice(0, 3) });
// Header checks on every HTML document the journey loaded, plus explicit curl-style fetches.
const need = (h) => { const csp = h['content-security-policy'] || ''; const ss = (csp.match(/script-src[^;]*/) || [''])[0];
  return { nonceCsp: /'nonce-[^']+'/.test(ss), noUnsafe: !/'unsafe-(inline|eval)'/.test(ss), frame: /frame-ancestors 'none'/.test(csp), nosniff: h['x-content-type-options'] === 'nosniff', referrer: !!h['referrer-policy'], hsts: !!h['strict-transport-security'], powered: h['x-powered-by'] === undefined }; };
const ok = (n) => Object.values(n).every(Boolean);
const seen = new Set();
for (const d of docs) { if (!/text\/html/.test(d.h['content-type'] || '')) continue; seen.add(d.status + ' ' + d.url + ' #' + seen.size); const n = need(d.h); A.check(`HTML ${d.status} ${d.url.replace(BASE, '') || '/'}: nonce CSP w/o unsafe-*, frame-ancestors 'none', nosniff, Referrer-Policy, HSTS, no X-Powered-By`, ok(n), n); }
A.check('the journey loaded HTML documents including a 404 and the error state', docs.some((d) => d.status === 404) && seen.size >= 4, { htmlDocs: seen.size });
const matrix = [];
for (const p of ['/', '/projects', '/does-not-exist', '/auth/login', '/signed-out', '/sign-in-problem']) {
  let r; try { r = await fetch(BASE + p, { redirect: 'manual' }); await r.arrayBuffer(); } catch (e) { A.check(`curl-style GET ${p}: request succeeded`, false, String(e.cause?.code || e.message)); continue; }
  const h = Object.fromEntries(r.headers); const html = /text\/html/.test(h['content-type'] || ''); const n = need(h);
  matrix.push({ path: p, status: r.status, html, ...n });
  if (html) A.check(`curl-style GET ${p} (${r.status}): full header set`, ok(n), n); else A.check(`curl-style GET ${p} (${r.status}, non-HTML): no X-Powered-By`, n.powered, { nosniff: n.nosniff, csp: !!h['content-security-policy'] });
}
writeFileSync(OUT + '/headers-matrix.json', JSON.stringify(matrix, null, 1));
// API headers (Helmet defaults, no X-Powered-By)
const apih = [];
for (const p of ['/health/live', '/v1/projects', '/v1/does-not-exist']) {
  const r = await fetch(env.API + p); await r.arrayBuffer(); const h = Object.fromEntries(r.headers);
  apih.push({ p, status: r.status, h: { csp: h['content-security-policy'], xcto: h['x-content-type-options'], hsts: h['strict-transport-security'], referrer: h['referrer-policy'], xfo: h['x-frame-options'], corp: h['cross-origin-resource-policy'], coop: h['cross-origin-opener-policy'], poweredBy: h['x-powered-by'] } });
  A.check(`API ${p} (${r.status}): Helmet defaults present (CSP, nosniff, Referrer-Policy, X-Frame-Options/frame-ancestors, CORP, COOP) and no X-Powered-By`, !!h['content-security-policy'] && h['x-content-type-options'] === 'nosniff' && !!h['referrer-policy'] && (!!h['x-frame-options'] || /frame-ancestors/.test(h['content-security-policy'] || '')) && !!h['cross-origin-resource-policy'] && !!h['cross-origin-opener-policy'] && h['x-powered-by'] === undefined, apih.at(-1).h);
}
writeFileSync(OUT + '/api-headers.json', JSON.stringify(apih, null, 1));
A.finish();
