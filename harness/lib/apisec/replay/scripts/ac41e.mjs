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
const cases = [
  ['MPA $ACTION_ID_ + name (no next-action header)', [[`$ACTION_ID_${id}`, ''], ['name', 'mpa-ok']], mpHdr],
  ['MPA $ACTION_ID_ bogus id', [[`$ACTION_ID_${'0'.repeat(42)}`, ''], ['name', 'x']], mpHdr],
  ['MPA $ACTION_REF_1 + $ACTION_1:0 id/bound $F1', [['$ACTION_REF_1', ''], ['$ACTION_1:0', JSON.stringify({ id, bound: '$@1' })], ['$ACTION_1:1', '["$F1"]'], ['name', 'x']], mpHdr],
  ['MPA $ACTION_REF_1 missing :0', [['$ACTION_REF_1', ''], ['name', 'x']], mpHdr],
  ['MPA $ACTION_REF_1 + :0 not json', [['$ACTION_REF_1', ''], ['$ACTION_1:0', '{'], ['$ACTION_1:1', '[]']], mpHdr],
  ['MPA $ACTION_REF_1 + :0 bound string', [['$ACTION_REF_1', ''], ['$ACTION_1:0', JSON.stringify({ id, bound: '$K9' })], ['$ACTION_1:1', '[]']], mpHdr],
  ['MPA $ACTION_REF_1 + :0 bound null', [['$ACTION_REF_1', ''], ['$ACTION_1:0', JSON.stringify({ id, bound: null })], ['$ACTION_1:1', '[]'], ['name', 'x']], mpHdr],
  ['MPA $ACTION_REF_1 + :1 nested $F', [['$ACTION_REF_1', ''], ['$ACTION_1:0', JSON.stringify({ id, bound: '$@1' })], ['$ACTION_1:1', '[["$F9"]]'], ['name', 'x']], mpHdr],
  ['MPA both ACTION_ID_ and ACTION_REF_', [[`$ACTION_ID_${id}`, ''], ['$ACTION_REF_1', ''], ['name', 'x']], mpHdr],
  ['MPA empty multipart', [], mpHdr],
  ['MPA urlencoded $ACTION_ID_', null, { 'content-type': 'application/x-www-form-urlencoded' }, `%24ACTION_ID_${id}=&name=urlenc`],
  ['MPA urlencoded garbage', null, { 'content-type': 'application/x-www-form-urlencoded' }, `%24ACTION_REF_1=&%24ACTION_1%3A0=%7B&name=x`],
  ['text/plain no next-action', null, { 'content-type': 'text/plain' }, '["$F1"]'],
  ['JSON no next-action', null, { 'content-type': 'application/json' }, '["$F1"]'],
  ['next-action multipart 0=[$$x,$undefined,$K1]', [['0', '["$$x","$undefined","$K1"]'], ['1_name', 'ok-escaped']], { ...mpHdr, 'next-action': id }],
  ['next-action multipart 0=["$K99999999999999999999"]', [['0', '["$K99999999999999999999"]']], { ...mpHdr, 'next-action': id }],
  ['next-action multipart 0=["$K1"] + extra field $ACTION_REF_1', [['0', '["$K1"]'], ['$ACTION_REF_1', ''], ['1_name', 'x']], { ...mpHdr, 'next-action': id }],
  ['next-action multipart 0=["$K1"] + field "1_$F1"', [['0', '["$K1"]'], ['1_$F1', 'x'], ['2_x', 'y']], { ...mpHdr, 'next-action': id }],
  ['next-action multipart 0 with deep nesting 20000', [['0', '['.repeat(20000) + ']'.repeat(20000)]], { ...mpHdr, 'next-action': id }],
  ['next-action multipart 0 object key "$F1"', [['0', '[{"$F1":"x"},"$K1"]'], ['1_name', 'x']], { ...mpHdr, 'next-action': id }],
  ['next-action bogus id multipart', [['0', '["$K1"]'], ['1_name', 'x']], { ...mpHdr, 'next-action': 'zz' }],
  ['next-action bogus id (42 zeros) multipart', [['0', '["$K1"]'], ['1_name', 'x']], { ...mpHdr, 'next-action': '0'.repeat(42) }],
  ['next-action id x2 header via list', [['0', '["$K1"]'], ['1_name', 'x']], { ...mpHdr, 'next-action': id + ', ' + id }],
];
for (const [label, parts, headers, raw] of cases) {
  const res = await post('/projects', headers, raw ?? mp(parts));
  R({ label, status: res.status, excerpt: res.t.slice(0, 110).replace(/\n/g, ' '), digestError: /E\{"digest"/.test(res.t) });
}
writeFileSync(out + '/results-e.json', JSON.stringify(rows, null, 1));
