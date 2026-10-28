// Progressive-enhancement (no next-action header) form posts and other crafted Server Action shapes, same-origin, with alice's session.
import { chromium, kcLogin } from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
const env = process.env, BASE = 'http://localhost:3103', out = env.OUT;
const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage();
await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
const formHtml = await page.locator('form').first().evaluate((f) => f.outerHTML);
writeFileSync(out + '/create-form.html', formHtml);
const hidden = await page.locator('form').first().evaluate((f) => [...f.querySelectorAll('input')].map((i) => ({ name: i.name, type: i.type, value: i.value.slice(0, 80) })));
console.log(JSON.stringify(hidden));
let id; page.on('request', (rq) => { if (rq.method() === 'POST' && rq.headers()['next-action'] && !id) id = rq.headers()['next-action']; });
await page.getByLabel('Project name').fill('ac41e'); await page.getByRole('button', { name: 'Create project' }).click();
await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
const cookie = (await ctx.cookies(BASE)).map((c) => c.name + '=' + c.value).join('; ');
await browser.close();
const rows = []; const R = (o) => { rows.push(o); console.log(JSON.stringify(o)); };
const B = '----zboundary';
const mp = (parts) => parts.map(([k, v]) => `--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('') + `--${B}--\r\n`;
function post(path, headers, body) {
  return new Promise((resolve) => {
    const rq = httpRequest({ host: '127.0.0.1', port: 3103, path, method: 'POST', headers: { host: 'localhost:3103', origin: BASE, 'sec-fetch-site': 'same-origin', 'content-length': Buffer.byteLength(body), cookie, ...headers } }, (r) => { let t = ''; r.on('data', (d) => (t += d)); r.on('end', () => resolve({ status: r.statusCode, t })); });
    rq.on('error', (e) => resolve({ status: 'socket-error ' + e.code, t: '' })); rq.end(body);
  });
}
const mpHdr = { 'content-type': 'multipart/form-data; boundary=' + B };

const cases = [];
for (const cookieOn of [true, false]) {
  const H = (h) => ({ ...h, ...(cookieOn ? {} : { cookie: '' }) });
  cases.push([`cookie=${cookieOn} MPA $ACTION_1:1=["$F1"]`, [['$ACTION_REF_1', ''], ['$ACTION_1:0', JSON.stringify({ id, bound: '$@1' })], ['$ACTION_1:1', '["$F1"]'], ['name', 'x']], H(mpHdr)]);
  for (const d of [1000, 2000, 3000, 5000, 10000, 20000, 100000]) cases.push([`cookie=${cookieOn} next-action field0 ${d}-level nested arrays`, [['0', '['.repeat(d) + ']'.repeat(d)]], H({ ...mpHdr, 'next-action': id })]);
}
for (const [label, parts, headers] of cases) {
  const res = await post('/projects', headers, mp(parts));
  R({ label, status: res.status, excerpt: res.t.slice(0, 80).replace(/\n/g, ' ') });
}
writeFileSync(out + '/results-f.json', JSON.stringify(rows, null, 1));
