import { chromium, kcLogin } from './lib.mjs';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const env = process.env, BASE = 'http://localhost:3103', out = env.OUT;
const rows = []; const R = (o) => { rows.push(o); console.log(JSON.stringify(o)); };
const sql = (q) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '55440', '-U', 'postgres', '-d', 'z5_main_test', '-Atc', q], { env: { ...process.env, PGPASSWORD: env.PG_PASSWORD } }).toString().trim();
const browser = await chromium.launch();
const ctx = await browser.newContext({ recordVideo: { dir: out + '/video' } }); const page = await ctx.newPage();
const consoleMsgs = []; page.on('console', (m) => consoleMsgs.push(m.text()));
await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
let cap; page.on('request', async (r) => { if (r.method() === 'POST' && r.headers()['next-action'] && !cap) cap = { url: r.url(), headers: await r.allHeaders(), body: r.postDataBuffer() }; });
await page.getByLabel('Project name').fill('CSRF-control-legit'); await page.getByRole('button', { name: 'Create project' }).click();
await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
const actionId = cap.headers['next-action'];
R({ step: 'captured create action', actionId: actionId.slice(0, 8) + '…', origin: cap.headers.origin, secFetchSite: cap.headers['sec-fetch-site'] });
const boundary = cap.headers['content-type'].split('boundary=')[1];
const bodyWith = (name) => Buffer.from(cap.body.toString('latin1').replace('CSRF-control-legit', name), 'latin1');
const base = Object.fromEntries(Object.entries(cap.headers).filter(([k]) => !['cookie', 'content-length', 'host', 'origin', 'referer', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].includes(k)));
async function replay(label, name, extra) {
  const before = sql(`SELECT count(*) FROM projects WHERE name='${name}'`);
  const r = await ctx.request.post(cap.url, { headers: { ...base, ...extra }, data: bodyWith(name), maxRedirects: 0 });
  const t = await r.text();
  const after = sql(`SELECT count(*) FROM projects WHERE name='${name}'`);
  R({ case: label, sentHeaders: extra, status: r.status(), actionResult: (t.match(/\{"status":"(?:error|success)"[^}]*\}/) || [null])[0], errorDigest: (t.match(/E\{"digest":"\d+"\}/) || [null])[0], bodyExcerpt: t.slice(0, 160), rowsBefore: before, rowsAfter: after, wrote: after !== before });
}
await replay('control: same-origin replay', 'CSRF-same-origin', { origin: BASE, 'sec-fetch-site': 'same-origin' });
await replay('A: Origin https://evil.example', 'CSRF-A-evil-origin', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' });
await replay('B: no Origin, Sec-Fetch-Site: cross-site', 'CSRF-B-no-origin-xsite', { 'sec-fetch-site': 'cross-site' });
await replay('B2: no Origin, no Sec-Fetch-Site', 'CSRF-B2-no-origin', {});
await replay('C: Origin null', 'CSRF-C-null', { origin: 'null', 'sec-fetch-site': 'cross-site' });
await replay('D: Origin http://localhost:50330 (same-site, cross-origin)', 'CSRF-D-same-site', { origin: 'http://localhost:50330', 'sec-fetch-site': 'same-site' });
await replay('G: correct Origin but Sec-Fetch-Site: cross-site', 'CSRF-G-origin-ok-xsite', { origin: BASE, 'sec-fetch-site': 'cross-site' });
await replay('H: Origin evil, no Sec-Fetch-Site', 'CSRF-H-evil-no-sfs', { origin: 'https://evil.example' });
await replay('I: Referer evil only', 'CSRF-I-referer', { referer: 'https://evil.example/x' });
await replay('E: Origin evil + X-Forwarded-Host evil.example', 'CSRF-E-xfh', { origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' });
// auto-submitting attacker page in Chromium
const evilHtml = (target) => `<!doctype html><title>evil</title><form id=f method=POST action="${target}/projects" enctype="multipart/form-data"><input name="$ACTION_ID_${actionId}" value=""><input name="name" value="CSRF-FORM-AUTOSUBMIT"></form><script>document.getElementById('f').submit()</script>`;
const srv = createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(evilHtml(BASE)); }).listen(50330, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
for (const evilOrigin of ['http://localhost:50330', 'http://127.0.0.1:50330']) {
  const before = sql(`SELECT count(*) FROM projects WHERE name='CSRF-FORM-AUTOSUBMIT'`);
  const seen = [];
  const h = async (resp) => { if (resp.url().startsWith(BASE + '/projects') && resp.request().method() === 'POST') seen.push({ status: resp.status(), sentOrigin: (await resp.request().allHeaders()).origin, sentCookie: /app_session=/.test((await resp.request().allHeaders()).cookie || '') }); };
  page.on('response', h);
  await page.goto(evilOrigin + '/'); await page.waitForTimeout(3000);
  page.off('response', h);
  await page.screenshot({ path: out + `/autosubmit-${evilOrigin.replace(/\W+/g, '_')}.png` });
  const after = sql(`SELECT count(*) FROM projects WHERE name='CSRF-FORM-AUTOSUBMIT'`);
  R({ case: 'F: auto-submit form from ' + evilOrigin, landedUrl: page.url(), responses: seen, bodyText: (await page.locator('body').innerText().catch(() => '')).slice(0, 200), rowsBefore: before, rowsAfter: after, wrote: after !== before });
}
srv.close();
for (const [label, hdr] of [['refresh Origin evil', { origin: 'https://evil.example' }], ['refresh no Origin', {}], ['refresh same origin (control)', { origin: BASE }]]) { const r = await ctx.request.post(BASE + '/auth/refresh', { headers: hdr, maxRedirects: 0 }); R({ case: 'route handler POST /auth/refresh: ' + label, status: r.status(), body: (await r.text()).slice(0, 80) }); }
await browser.close();
writeFileSync(out + '/results.json', JSON.stringify(rows, null, 1));
