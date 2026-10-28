// AC-39: cross-site requests cannot act as the user; API CORS is closed by default and exact when WEB_ORIGIN is set.
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { Asserts, env, OUT, chromium, kcLogin, sql } from './lib.mjs';
const A = new Asserts('AC-39');
const BASE = env.WEB, DB = env.DB;
const rows = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ recordVideo: { dir: OUT + '/video' } }); const page = await ctx.newPage();
try {
  await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
  let cap; page.on('request', async (r) => { if (r.method() === 'POST' && r.headers()['next-action'] && !cap) cap = { url: r.url(), headers: await r.allHeaders(), body: r.postDataBuffer() }; });
  await page.getByLabel('Project name').fill('CSRF-control-legit'); await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
  const actionId = cap.headers['next-action'];
  const bodyWith = (n) => Buffer.from(cap.body.toString('latin1').replace('CSRF-control-legit', n), 'latin1');
  const base = Object.fromEntries(Object.entries(cap.headers).filter(([k]) => !['cookie', 'content-length', 'host', 'origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].includes(k)));
  const count = (n) => sql(DB, `SELECT count(*) FROM projects WHERE name='${n}'`);
  async function replay(label, name, extra, mustReject = true) {
    const b = count(name);
    const r = await ctx.request.post(cap.url, { headers: { ...base, ...extra }, data: bodyWith(name), maxRedirects: 0 });
    const t = await r.text(); const a = count(name);
    rows.push({ label, status: r.status(), wrote: a !== b });
    if (mustReject) A.check(`${label}: rejected (403) and no write`, r.status() === 403 && a === b, { status: r.status(), wrote: a !== b });
    else A.check(`${label}: control succeeds and writes`, r.status() === 200 && a !== b && /"status":"success"/.test(t), { status: r.status() });
  }
  await replay('control same-origin replay', 'CSRF-same-origin', { origin: BASE, 'sec-fetch-site': 'same-origin' }, false);
  await replay('Origin https://evil.example', 'CSRF-A', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
  await replay('no Origin, Sec-Fetch-Site cross-site', 'CSRF-B', { 'sec-fetch-site': 'cross-site' });
  await replay('Origin null', 'CSRF-C', { origin: 'null', 'sec-fetch-site': 'cross-site' });
  await replay('Origin of another local port (same-site)', 'CSRF-D', { origin: 'http://localhost:50330', 'sec-fetch-site': 'same-site' });
  await replay('correct Origin but Sec-Fetch-Site cross-site', 'CSRF-G', { origin: BASE, 'sec-fetch-site': 'cross-site' });
  await replay('Origin evil without Sec-Fetch-Site', 'CSRF-H', { origin: 'https://evil.example' });
  await replay('Referer evil only', 'CSRF-I', { referer: 'https://evil.example/x' });
  await replay('Origin evil + X-Forwarded-Host evil', 'CSRF-E', { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' });
  const evilHtml = `<!doctype html><title>evil</title><form id=f method=POST action="${BASE}/projects" enctype="multipart/form-data"><input name="$ACTION_ID_${actionId}" value=""><input name="name" value="CSRF-FORM-AUTOSUBMIT"></form><script>document.getElementById('f').submit()</script>`;
  const srv = createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(evilHtml); }).listen(50330, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  for (const o of ['http://localhost:50330', 'http://127.0.0.1:50330']) {
    const b = count('CSRF-FORM-AUTOSUBMIT'); const seen = [];
    const h = (resp) => { if (resp.url().startsWith(BASE + '/projects') && resp.request().method() === 'POST') seen.push(resp.status()); };
    page.on('response', h); await page.goto(o + '/'); await page.waitForTimeout(3000); page.off('response', h);
    await page.screenshot({ path: OUT + `/autosubmit-${o.replace(/\W+/g, '_')}.png` });
    A.check(`auto-submitting HTML form served from ${o}: submitted cross-origin, rejected, no write`, seen.length > 0 && seen.every((s) => s === 403) && count('CSRF-FORM-AUTOSUBMIT') === b, { responses: seen });
  }
  srv.close();
  for (const [l, h, want] of [['/auth/refresh Origin evil', { origin: 'https://evil.example' }, 403], ['/auth/refresh no Origin', {}, 403]]) {
    const r = await ctx.request.post(BASE + '/auth/refresh', { headers: h, maxRedirects: 0 });
    A.check(`${l}: 403`, r.status() === want, { status: r.status() });
  }
  // API CORS: WEB_ORIGIN unset (API_A) and WEB_ORIGIN=http://localhost:3000 (API_B)
  const probe = async (api, origin, method) => {
    const init = method === 'OPTIONS' ? { method, headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } } : { method, headers: { origin } };
    const r = await fetch(api + '/v1/projects', init); await r.arrayBuffer();
    return { status: r.status, acao: r.headers.get('access-control-allow-origin'), acac: r.headers.get('access-control-allow-credentials') };
  };
  for (const [name, api, allowed] of [['WEB_ORIGIN unset', env.API_A, null], ['WEB_ORIGIN=http://localhost:3000', env.API_B, 'http://localhost:3000']]) {
    for (const origin of ['https://evil.example', 'null', 'http://localhost:3000']) for (const m of ['OPTIONS', 'GET']) {
      const p = await probe(api, origin, m); rows.push({ name, origin, m, ...p });
      const okAcao = p.acao === null || (allowed && p.acao === allowed && origin === allowed);
      A.check(`API ${name}: ${m} with Origin ${origin}: ACAO is never * and never reflects an unlisted origin; no Allow-Credentials: true`, okAcao && p.acao !== '*' && p.acac !== 'true', p);
    }
    if (allowed) { const p = await probe(api, allowed, 'OPTIONS'); A.check(`API ${name}: the configured origin is allowed exactly`, p.acao === allowed, p); }
  }
} catch (e) { A.check('script completed without exception', false, String(e.stack || e).slice(0, 400)); }
await browser.close();
writeFileSync(OUT + '/results.json', JSON.stringify(rows, null, 1));
A.finish();
