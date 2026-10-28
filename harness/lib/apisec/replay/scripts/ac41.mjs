import { chromium, kcLogin } from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
const env = process.env, BASE = 'http://localhost:3103', API = 'http://127.0.0.1:4103', out = env.OUT;
const rows = []; const R = (o) => { rows.push(o); console.log(JSON.stringify(o)); };
const tok = (await (await fetch('http://localhost:8080/realms/acme-z5/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'acme-cli', client_secret: env.ACME_CLI_SECRET, username: 'alice', password: env.ALICE_PASSWORD }) })).json()).access_token;
const H = { authorization: 'Bearer ' + tok };
async function api(label, method, path, raw, ctype = 'application/json') {
  const r = await fetch(API + path, { method, headers: { ...H, ...(raw !== undefined ? { 'content-type': ctype } : {}) }, body: raw });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch {}
  R({ layer: 'api', label, method, path: path.slice(0, 60), status: r.status, ctype: r.headers.get('content-type')?.split(';')[0], code: j?.code, errors: j?.errors?.map((e) => e.field + ':' + e.code).join(' '), bytes: raw?.length });
  return { r, j };
}
const RTL = 'abc‮def‬', EMOJI = '🚀 Projekt 👩‍💻 ünï', COMB = 'é́ ﻿zw​j';
const nested = (n) => '['.repeat(n) + ']'.repeat(n);
await api('name 101 chars', 'POST', '/v1/projects', JSON.stringify({ name: 'a'.repeat(101) }));
await api('name 100 chars (valid boundary)', 'POST', '/v1/projects', JSON.stringify({ name: 'b'.repeat(100) }));
await api('whitespace only', 'POST', '/v1/projects', JSON.stringify({ name: '   ' }));
await api('tabs/newlines only', 'POST', '/v1/projects', JSON.stringify({ name: '\t\n 　' }));
await api('NUL byte', 'POST', '/v1/projects', JSON.stringify({ name: 'a\u0000b' }));
await api('unknown field', 'POST', '/v1/projects', JSON.stringify({ name: 'x', extra: 1 }));
await api('name number', 'POST', '/v1/projects', JSON.stringify({ name: 5 }));
await api('name null', 'POST', '/v1/projects', JSON.stringify({ name: null }));
await api('name array', 'POST', '/v1/projects', JSON.stringify({ name: ['x'] }));
await api('name object', 'POST', '/v1/projects', JSON.stringify({ name: { a: 1 } }));
await api('empty body object', 'POST', '/v1/projects', '{}');
await api('body is array', 'POST', '/v1/projects', '[]');
await api('body is string', 'POST', '/v1/projects', '"x"');
await api('invalid JSON', 'POST', '/v1/projects', '{"name":');
await api('10,000-level nested arrays', 'POST', '/v1/projects', nested(10000));
await api('10,000-level nested arrays in name', 'POST', '/v1/projects', '{"name":' + nested(10000) + '}');
await api('3,000-level nested objects', 'POST', '/v1/projects', '{"a":'.repeat(3000) + '1' + '}'.repeat(3000));
await api('33 KB body', 'POST', '/v1/projects', JSON.stringify({ name: 'x'.repeat(33 * 1024) }));
await api('1 MB body', 'POST', '/v1/projects', JSON.stringify({ name: 'x'.repeat(1024 * 1024) }));
await api('text/plain content type', 'POST', '/v1/projects', JSON.stringify({ name: 'x' }), 'text/plain');
await api('limit=100000&offset=-1', 'GET', '/v1/projects?limit=100000&offset=-1');
await api('limit=100000', 'GET', '/v1/projects?limit=100000');
await api('offset=-1', 'GET', '/v1/projects?offset=-1');
await api('limit=abc', 'GET', '/v1/projects?limit=abc');
await api('limit=1e3', 'GET', '/v1/projects?limit=1e3');
await api('limit repeated', 'GET', '/v1/projects?limit=1&limit=2');
await api('offset=99999999999999999999', 'GET', '/v1/projects?offset=99999999999999999999');
await api('unknown query param', 'GET', '/v1/projects?foo=1');
await api('limit=100 (max)', 'GET', '/v1/projects?limit=100');
await api('bad uuid path', 'GET', '/v1/projects/not-a-uuid');
const created = await api('create for rename', 'POST', '/v1/projects', JSON.stringify({ name: 'rename-me' }));
const id = created.j.id;
await api('PATCH expectedVersion string', 'PATCH', '/v1/projects/' + id, JSON.stringify({ name: 'x', expectedVersion: '1' }));
await api('PATCH expectedVersion 0', 'PATCH', '/v1/projects/' + id, JSON.stringify({ name: 'x', expectedVersion: 0 }));
await api('PATCH expectedVersion 2^31', 'PATCH', '/v1/projects/' + id, JSON.stringify({ name: 'x', expectedVersion: 2147483648 }));
await api('PATCH expectedVersion 1.5', 'PATCH', '/v1/projects/' + id, JSON.stringify({ name: 'x', expectedVersion: 1.5 }));
await api('PATCH missing name', 'PATCH', '/v1/projects/' + id, JSON.stringify({ expectedVersion: 1 }));
for (const [label, v] of [['RTL override', RTL], ['emoji/ZWJ', EMOJI], ['combining/ZW chars', COMB]]) {
  const c = await api('unicode create ' + label, 'POST', '/v1/projects', JSON.stringify({ name: v }));
  const g = await fetch(API + '/v1/projects/' + c.j.id, { headers: H }).then((r) => r.json());
  R({ layer: 'api', label: 'unicode round-trip ' + label, createdEqual: c.j.name === v, readEqual: g.name === v, hexIn: Buffer.from(v).toString('hex'), hexOut: Buffer.from(g.name).toString('hex') });
}
// ---------- web ----------
const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage();
await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
let createAction;
page.on('request', async (rq) => { if (rq.method() === 'POST' && rq.headers()['next-action'] && !createAction) createAction = { url: rq.url(), headers: await rq.allHeaders(), body: rq.postDataBuffer() }; });
async function viaForm(label, value) {
  await page.goto(BASE + '/projects');
  await page.getByLabel('Project name').fill(value);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('status').filter({ hasText: /\S/ }).waitFor({ timeout: 10000 }).catch(() => {});
  const status = await page.getByRole('status').textContent();
  const fieldError = await page.locator('#name-error').textContent().catch(() => null);
  const invalid = await page.getByLabel('Project name').getAttribute('aria-invalid');
  const kept = await page.getByLabel('Project name').inputValue();
  R({ layer: 'web-form', label, status, fieldError, ariaInvalid: invalid, inputKept: kept === value, focused: await page.evaluate(() => document.activeElement?.id) });
}
await viaForm('valid seed (captures action)', 'web-seed');
await viaForm('name 101 chars', 'a'.repeat(101));
await viaForm('whitespace only', '   ');
await viaForm('NUL byte', 'a\u0000b');
await viaForm('RTL override', RTL);
await viaForm('emoji/ZWJ', EMOJI);
// direct action calls with crafted multipart bodies
const hdrs = Object.fromEntries(Object.entries(createAction.headers).filter(([k]) => !['cookie', 'content-length', 'content-type', 'host'].includes(k)));
const original = createAction.body.toString('latin1');
const boundary = createAction.headers['content-type'].split('boundary=')[1];
function craft(fields) {
  // keep the original action-state parts ($ACTION_* / 1_ etc.) and replace/add 'name' parts
  const parts = original.split('--' + boundary).filter((p) => p.trim() && p.trim() !== '--');
  const kept = parts.filter((p) => !/name="(_?\d+_)?name"/.test(p));
  const prefix = (parts.find((p) => /name="(_?\d+_)?name"/.test(p)) || '').match(/name="((_?\d+_)?)name"/)?.[1] ?? '';
  // Next streams multipart: the form-data fields must precede the action-state part "0".
  let body = '';
  for (const [k, v] of fields) body += `--${boundary}\r\nContent-Disposition: form-data; name="${prefix}${k}"\r\n\r\n${v}\r\n`;
  body += kept.map((p) => '--' + boundary + p).join('');
  return Buffer.concat([Buffer.from(body, 'latin1').length ? Buffer.from(body.replace(/\r\n$/, '') + '\r\n', 'latin1') : Buffer.alloc(0), Buffer.from('--' + boundary + '--\r\n')]);
}
async function direct(label, fields, raw) {
  const data = raw ?? craft(fields.map(([k, v]) => [k, Buffer.from(v, 'utf8').toString('latin1')]));
  const r = await ctx.request.post(createAction.url, { headers: { ...hdrs, 'content-type': 'multipart/form-data; boundary=' + boundary }, data, maxRedirects: 0, timeout: 30000 });
  const t = await r.text();
  R({ layer: 'web-action-direct', label, status: r.status(), bytes: data.length, actionResult: (t.match(/\{"status":"(?:error|success)"[^}]*\}/) || [null])[0], errorDigest: (t.match(/E\{"digest":"\d+"\}/) || [null])[0] });
}
await direct('control valid', [['name', 'direct-ok']]);
await direct('name 101 chars', [['name', 'a'.repeat(101)]]);
await direct('whitespace only', [['name', '   ']]);
await direct('NUL byte', [['name', 'a\u0000b']]);
await direct('missing name', []);
await direct('two name fields', [['name', 'one'], ['name', 'two']]);
await direct('unknown extra field', [['name', 'direct-extra'], ['extra', '1'], ['ownerId', 'bob']]);
await direct('name 900 KB', [['name', 'x'.repeat(900 * 1024)]]);
await direct('name 2 MB (over Next default 1 MB action limit)', [['name', 'x'.repeat(2 * 1024 * 1024)]]);
await direct('garbage body', [], Buffer.from('not multipart at all'));
await direct('RTL override', [['name', RTL]]);
await direct('emoji/ZWJ', [['name', EMOJI]]);
// chunked transfer (no content-length) so the proxy's content-length check cannot see the size
async function chunked(label, data, ctype) {
  const cookie = (await ctx.cookies(BASE)).map((c) => c.name + '=' + c.value).join('; ');
  const u = new URL(createAction.url);
  const res = await new Promise((resolve) => {
    const rq = httpRequest({ host: '127.0.0.1', port: 3103, path: u.pathname, method: 'POST', headers: { ...hdrs, host: 'localhost:3103', cookie, 'content-type': ctype ?? 'multipart/form-data; boundary=' + boundary, 'transfer-encoding': 'chunked' } }, (r) => { let t = ''; r.on('data', (d) => (t += d)); r.on('end', () => resolve({ status: r.statusCode, t })); });
    rq.on('error', (e) => resolve({ status: 'socket-error ' + e.code, t: '' }));
    for (let i = 0; i < data.length; i += 65536) rq.write(data.subarray(i, i + 65536));
    rq.end();
  });
  R({ layer: 'web-action-direct', label, status: res.status, bytes: data.length, actionResult: (res.t.match(/\{"status":"(?:error|success)"[^}]*\}/) || [null])[0], errorDigest: (res.t.match(/E\{"digest":"\d+"\}/) || [null])[0], excerpt: res.t.slice(0, 120) });
}
await chunked('name 2 MB, chunked (no content-length)', craft([['name', 'x'.repeat(2 * 1024 * 1024)]]));
await chunked('name 900 KB, chunked (no content-length)', craft([['name', 'y'.repeat(900 * 1024)]]));
await chunked('garbage multipart, chunked', Buffer.from('not multipart at all'));
await direct('text/plain body to action', [], Buffer.from('name=direct-textplain'));
await browser.close();
writeFileSync(out + '/results.json', JSON.stringify(rows, null, 1));
