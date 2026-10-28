// Server Action abuse: wrong-typed arguments (JSON-encoded action payloads) and chunked bodies, with and without a session cookie.
import { chromium, kcLogin } from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
const env = process.env, BASE = 'http://localhost:3103', out = env.OUT;
const rows = []; const R = (o) => { rows.push(o); console.log(JSON.stringify(o)); };
const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage();
await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
const caps = {};
page.on('request', async (rq) => { const id = rq.headers()['next-action']; if (rq.method() === 'POST' && id && !caps[id]) caps[id] = { url: rq.url(), headers: await rq.allHeaders(), body: rq.postDataBuffer() }; });
await page.getByLabel('Project name').fill('ac41b-create'); await page.getByRole('button', { name: 'Create project' }).click();
await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
await page.getByRole('link', { name: 'Open created project' }).click(); await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
await page.getByLabel('Project name').fill('ac41b-renamed'); await page.getByRole('button', { name: 'Save name' }).click();
await page.getByRole('status').filter({ hasText: 'Project renamed.' }).waitFor();
const ids = Object.keys(caps); R({ step: 'captured actions', count: ids.length, ids: ids.map((i) => i.slice(0, 8) + '…'), paths: ids.map((i) => new URL(caps[i].url).pathname.replace(/[0-9a-f-]{36}/, '<id>')) });
const cookie = (await ctx.cookies(BASE)).map((c) => c.name + '=' + c.value).join('; ');
function post(path, headers, body, chunked) {
  return new Promise((resolve) => {
    const h = { host: 'localhost:3103', origin: BASE, 'sec-fetch-site': 'same-origin', ...headers };
    if (!chunked) h['content-length'] = Buffer.byteLength(body); else h['transfer-encoding'] = 'chunked';
    const rq = httpRequest({ host: '127.0.0.1', port: 3103, path, method: 'POST', headers: h }, (r) => { let t = ''; r.on('data', (d) => (t += d)); r.on('end', () => resolve({ status: r.statusCode, t })); });
    rq.on('error', (e) => resolve({ status: 'socket-error ' + e.code, t: '' }));
    if (chunked) { for (let i = 0; i < body.length; i += 65536) rq.write(body.subarray(i, i + 65536)); rq.end(); } else rq.end(body);
  });
}
const argSets = [['["not-a-form"]'], ['[{"status":"idle"},"not-a-form"]'], ['[{},5]'], ['[{}]'], ['[]'], ['{"x":1}'], ['[null,null]'], ['[{"status":"idle"},{"name":"x"}]'], ['[1,2,3,4]'], ['null'], ['"str"'], ['[[],[]]']];
for (const [label, cap] of ids.map((i) => [new URL(caps[i].url).pathname.includes('/projects/') ? 'rename' : 'create', caps[i]])) {
  const id = cap.headers['next-action'];
  for (const withCookie of [false, true]) {
    for (const [a] of argSets) {
      const res = await post(new URL(cap.url).pathname, { 'next-action': id, 'content-type': 'text/plain;charset=UTF-8', ...(withCookie ? { cookie } : {}) }, a);
      R({ kind: 'wrong-args', action: label, cookie: withCookie, args: a, status: res.status, digestError: /E\{"digest"/.test(res.t), excerpt: res.t.slice(0, 160).replace(/\n/g, ' ') });
    }
    for (const [name, size, chunked] of [['2MB chunked', 2 * 1024 * 1024, true], ['2MB length', 2 * 1024 * 1024, false], ['small chunked', 170, true], ['small length', 170, false]]) {
      const body = Buffer.from('x'.repeat(size));
      const res = await post(new URL(cap.url).pathname, { 'next-action': id, 'content-type': cap.headers['content-type'], ...(withCookie ? { cookie } : {}) }, body, chunked);
      R({ kind: 'size', action: label, cookie: withCookie, case: name, status: res.status, excerpt: res.t.slice(0, 100).replace(/\n/g, ' ') });
    }
  }
}
await browser.close();
writeFileSync(out + '/results-b.json', JSON.stringify(rows, null, 1));
