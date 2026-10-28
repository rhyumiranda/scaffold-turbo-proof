// Multipart Server Action requests whose action-argument field "0" is malformed, with and without a session cookie.
import { chromium, kcLogin } from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
const env = process.env, BASE = 'http://localhost:3103', out = env.OUT;
const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage();
await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
const caps = {}; page.on('request', async (rq) => { const id = rq.headers()['next-action']; if (rq.method() === 'POST' && id && !caps[id]) caps[id] = { url: rq.url(), id }; });
await page.getByLabel('Project name').fill('ac41d-create'); await page.getByRole('button', { name: 'Create project' }).click();
await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
await page.getByRole('link', { name: 'Open created project' }).click(); await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
await page.getByLabel('Project name').fill('ac41d-renamed'); await page.getByRole('button', { name: 'Save name' }).click();
await page.getByRole('status').filter({ hasText: 'Project renamed.' }).waitFor();
const cookie = (await ctx.cookies(BASE)).map((c) => c.name + '=' + c.value).join('; ');
await browser.close();
const rows = []; const R = (o) => { rows.push(o); console.log(JSON.stringify(o)); };
const B = '----zboundary';
const mp = (parts) => parts.map(([k, v]) => `--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('') + `--${B}--\r\n`;
function post(path, headers, body) {
  return new Promise((resolve) => {
    const rq = httpRequest({ host: '127.0.0.1', port: 3103, path, method: 'POST', headers: { host: 'localhost:3103', origin: BASE, 'sec-fetch-site': 'same-origin', 'content-length': Buffer.byteLength(body), ...headers } }, (r) => { let t = ''; r.on('data', (d) => (t += d)); r.on('end', () => resolve({ status: r.statusCode, t })); });
    rq.on('error', (e) => resolve({ status: 'socket-error ' + e.code, t: '' })); rq.end(body);
  });
}
const zeroValues = ['null', '"str"', '5', 'true', '1.5', '', '[', '{"a":1}', '[]', '["$K1"]', '[{"status":"idle"},"$K1"]', '[{"status":"idle"},5]', '["$F1"]', '["$F1","$K1"]', '[{"status":"idle"},"$K1","$K1"]', '[null,null]', '"$K1"', '[["x"]]', '{"0":1,"length":2}', '[{"__proto__":{"a":1}},"$K1"]'];
for (const [label, cap] of Object.entries(caps).map(([i, c]) => [new URL(c.url).pathname.includes('/projects/') ? 'rename' : 'create', c])) {
  for (const withCookie of [false, true]) {
    for (const z of zeroValues) {
      const res = await post(new URL(cap.url).pathname, { 'next-action': cap.id, 'content-type': 'multipart/form-data; boundary=' + B, ...(withCookie ? { cookie } : {}) }, mp([['_1_name', 'z-multipart-' + z.length], ['0', z]]));
      R({ kind: 'multipart field0', action: label, cookie: withCookie, field0: z, status: res.status, digestError: /E\{"digest"/.test(res.t), excerpt: res.t.slice(0, 110).replace(/\n/g, ' ') });
    }
    const res2 = await post(new URL(cap.url).pathname, { 'next-action': cap.id, 'content-type': 'multipart/form-data; boundary=' + B, ...(withCookie ? { cookie } : {}) }, mp([['_1_name', 'only-name']]));
    R({ kind: 'multipart no field0', action: label, cookie: withCookie, status: res2.status, digestError: /E\{"digest"/.test(res2.t), excerpt: res2.t.slice(0, 110).replace(/\n/g, ' ') });
    const res3 = await post(new URL(cap.url).pathname, { 'next-action': cap.id, 'content-type': 'multipart/form-data; boundary=' + B, ...(withCookie ? { cookie } : {}) }, mp([['0', '[{"status":"idle"},"$K1"]'], ['0', '[]'], ['_1_name', 'dup0']]));
    R({ kind: 'multipart duplicate field0', action: label, cookie: withCookie, status: res3.status, digestError: /E\{"digest"/.test(res3.t), excerpt: res3.t.slice(0, 110).replace(/\n/g, ' ') });
  }
}
writeFileSync(out + '/results-d.json', JSON.stringify(rows, null, 1));
