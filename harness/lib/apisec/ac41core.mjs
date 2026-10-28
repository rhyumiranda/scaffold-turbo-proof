// AC-41 core cases: every case the criterion lists, against the API (direct) and the web (form + action endpoint).
// env: API=http://127.0.0.1:4103  WEB=http://localhost:3103  DB (read-only checks)  OPENAPI (path to apps/api/openapi.json)
// Writes OUT/ids.json (action ids captured from the real form) for the replay stage.
import { writeFileSync, readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { Asserts, env, OUT, mint, reqWeb, problemShape, sql } from './lib.mjs';
const { chromium } = reqWeb('@playwright/test');
const A = new Asserts('AC-41');
const API = env.API, BASE = env.WEB;
const tok = await mint({});
const H = { authorization: 'Bearer ' + tok };
const rows = [];
async function api(label, method, path, raw, ctype = 'application/json', expect) {
  const r = await fetch(API + path, { method, headers: { ...H, ...(raw !== undefined ? { 'content-type': ctype } : {}) }, body: raw });
  const t = await r.text(); const s = problemShape(r, t);
  rows.push({ layer: 'api', label, status: r.status, ct: s.contentType, code: s.json?.code });
  if (expect === 'reject') A.check(`api ${label}: 4xx problem+json (never 5xx)`, r.status >= 400 && r.status < 500 && s.isProblemJson && s.hasFields, { status: r.status, ct: s.contentType });
  else if (expect === 'ok') A.check(`api ${label}: 2xx`, r.status >= 200 && r.status < 300, { status: r.status });
  return { r, json: s.json };
}
const RTL = 'abc‮def‬', EMOJI = '🚀 Projekt 👩‍💻 ünï', COMB = 'é́ ﻿zw​j';
const nested = (n) => '['.repeat(n) + ']'.repeat(n);
const R = 'reject';
await api('name of 101 chars', 'POST', '/v1/projects', JSON.stringify({ name: 'a'.repeat(101) }), undefined, R);
await api('name of 100 chars (boundary, valid)', 'POST', '/v1/projects', JSON.stringify({ name: 'b'.repeat(100) }), undefined, 'ok');
await api('whitespace only', 'POST', '/v1/projects', JSON.stringify({ name: '   ' }), undefined, R);
await api('tabs/newlines/ideographic space only', 'POST', '/v1/projects', JSON.stringify({ name: '\t\n 　' }), undefined, R);
await api('NUL byte', 'POST', '/v1/projects', JSON.stringify({ name: 'a\u0000b' }), undefined, R);
await api('unknown field', 'POST', '/v1/projects', JSON.stringify({ name: 'x', extra: 1 }), undefined, R);
await api('name is a number', 'POST', '/v1/projects', JSON.stringify({ name: 5 }), undefined, R);
await api('name is null', 'POST', '/v1/projects', JSON.stringify({ name: null }), undefined, R);
await api('name is an array', 'POST', '/v1/projects', JSON.stringify({ name: ['x'] }), undefined, R);
await api('name is an object', 'POST', '/v1/projects', JSON.stringify({ name: { a: 1 } }), undefined, R);
await api('empty object', 'POST', '/v1/projects', '{}', undefined, R);
await api('body is an array', 'POST', '/v1/projects', '[]', undefined, R);
await api('body is a string', 'POST', '/v1/projects', '"x"', undefined, R);
await api('invalid JSON', 'POST', '/v1/projects', '{"name":', undefined, R);
await api('10,000-level nested arrays', 'POST', '/v1/projects', nested(10000), undefined, R);
await api('10,000-level nested arrays inside name', 'POST', '/v1/projects', '{"name":' + nested(10000) + '}', undefined, R);
await api('3,000-level nested objects', 'POST', '/v1/projects', '{"a":'.repeat(3000) + '1' + '}'.repeat(3000), undefined, R);
await api('33 KB body', 'POST', '/v1/projects', JSON.stringify({ name: 'x'.repeat(33 * 1024) }), undefined, R);
await api('1 MB body', 'POST', '/v1/projects', JSON.stringify({ name: 'x'.repeat(1024 * 1024) }), undefined, R);
await api('Content-Type text/plain', 'POST', '/v1/projects', JSON.stringify({ name: 'x' }), 'text/plain', R);
// Pagination: limit must be capped or rejected per the OpenAPI schema.
const spec = JSON.parse(readFileSync(env.OPENAPI, 'utf8'));
const params = spec.paths['/v1/projects'].get.parameters;
const limitMax = params.find((p) => p.name === 'limit')?.schema?.maximum;
A.check('OpenAPI declares a maximum for `limit`', Number.isInteger(limitMax), { limitMax });
const big = await api('limit=100000&offset=-1', 'GET', '/v1/projects?limit=100000&offset=-1', undefined, undefined, R);
const lim = await api('limit=100000', 'GET', '/v1/projects?limit=100000');
rows.push({ layer: 'api', label: 'limit=100000 outcome', status: lim.r.status });
const limitOk = lim.r.status === 400 || (lim.r.status === 200 && Array.isArray(lim.json) && lim.json.length <= limitMax);
A.check('limit=100000 is rejected (4xx) or capped to the schema maximum', limitOk, { status: lim.r.status, returned: Array.isArray(lim.json) ? lim.json.length : null });
for (const [l, p] of [['offset=-1', '?offset=-1'], ['limit=abc', '?limit=abc'], ['limit=1e3', '?limit=1e3'], ['limit repeated', '?limit=1&limit=2'], ['offset=99999999999999999999', '?offset=99999999999999999999'], ['unknown query parameter', '?foo=1'], ['limit=0', '?limit=0'], ['limit=-5', '?limit=-5']])
  await api(l, 'GET', '/v1/projects' + p, undefined, undefined, R);
await api('limit at the maximum is accepted', 'GET', '/v1/projects?limit=' + limitMax, undefined, undefined, 'ok');
await api('id is not a uuid', 'GET', '/v1/projects/not-a-uuid', undefined, undefined, R);
const created = await api('create for rename', 'POST', '/v1/projects', JSON.stringify({ name: 'rename-me' }), undefined, 'ok');
const id = created.json.id;
const patch = (b) => JSON.stringify(b);
for (const [l, b] of [['expectedVersion is a string', { name: 'x', expectedVersion: '1' }], ['expectedVersion 0', { name: 'x', expectedVersion: 0 }], ['expectedVersion 2^31', { name: 'x', expectedVersion: 2147483648 }], ['expectedVersion 1.5', { name: 'x', expectedVersion: 1.5 }], ['missing name', { expectedVersion: 1 }], ['NUL byte in rename', { name: 'a\u0000b', expectedVersion: 1 }], ['whitespace rename', { name: '  ', expectedVersion: 1 }], ['101-char rename', { name: 'z'.repeat(101), expectedVersion: 1 }]])
  await api('PATCH ' + l, 'PATCH', '/v1/projects/' + id, patch(b), undefined, R);
// Unicode must round-trip byte for byte.
for (const [l, v] of [['RTL override', RTL], ['emoji with ZWJ', EMOJI], ['combining/zero-width characters', COMB]]) {
  const c = await api('create ' + l, 'POST', '/v1/projects', JSON.stringify({ name: v }), undefined, 'ok');
  const g = await (await fetch(API + '/v1/projects/' + c.json.id, { headers: H })).json();
  A.check(`api unicode round-trip (${l}) is byte-for-byte`, Buffer.from(g.name).equals(Buffer.from(v)) && c.json.name === v, { hexIn: Buffer.from(v).toString('hex'), hexOut: Buffer.from(g.name).toString('hex') });
}

// ---------------- web ----------------
const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage();
const kcLogin = async (user, pass) => { await page.waitForSelector('#username', { timeout: 20000 }); await page.fill('#username', user); await page.fill('#password', pass); await Promise.all([page.waitForLoadState('load'), page.click('#kc-login')]); };
await page.goto(BASE + '/auth/login'); await kcLogin('alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects', { timeout: 20000 });
const caps = {};
page.on('request', async (rq) => { const aid = rq.headers()['next-action']; if (rq.method() === 'POST' && aid && !caps[aid]) caps[aid] = { url: rq.url(), headers: await rq.allHeaders(), body: rq.postDataBuffer(), rename: new URL(rq.url()).pathname.includes('/projects/') }; });
async function viaForm(label, value, shouldCreate) {
  await page.goto(BASE + '/projects');
  await page.getByLabel('Project name').fill(value);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('status').filter({ hasText: /\S/ }).waitFor({ timeout: 15000 }).catch(() => {});
  const status = (await page.getByRole('status').textContent().catch(() => '')) || '';
  const fieldError = await page.locator('#name-error').textContent({ timeout: 1000 }).catch(() => null);
  const invalid = await page.getByLabel('Project name').getAttribute('aria-invalid').catch(() => null);
  rows.push({ layer: 'web-form', label, status, fieldError, invalid });
  if (shouldCreate) A.check(`web form ${label}: accepted ("Project created.")`, /Project created/.test(status) && !fieldError, { status, fieldError });
  else A.check(`web form ${label}: inline field error and aria-invalid`, !!fieldError && invalid === 'true', { status, fieldError, invalid });
}
await viaForm('valid seed (captures the create action)', 'web-seed', true);
await viaForm('name of 101 chars', 'a'.repeat(101), false);
await viaForm('whitespace only', '   ', false);
await viaForm('NUL byte', 'a\u0000b', false);
await viaForm('RTL override', RTL, true);
await viaForm('emoji with ZWJ', EMOJI, true);
// rename action: open the project page and save a name so the rename action id is captured
await page.goto(BASE + '/projects'); await page.getByRole('link', { name: 'web-seed', exact: true }).first().click(); await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
const renamePid = page.url().split('/').pop();
await page.getByLabel('Project name').fill('web-seed-renamed'); await page.getByRole('button', { name: 'Save name' }).click();
await page.getByRole('status').filter({ hasText: 'Project renamed.' }).waitFor({ timeout: 15000 }).catch(() => {});
const ids = Object.entries(caps);
const createEntry = ids.find(([, c]) => !c.rename), renameEntry = ids.find(([, c]) => c.rename);
A.check('captured both Server Action ids from the real form', !!createEntry && !!renameEntry, { create: !!createEntry, rename: !!renameEntry });
// The same values read back through the API: the RTL and emoji names must be stored exactly.
const list = await (await fetch(API + '/v1/projects?limit=100', { headers: H })).json();
const names = new Set(list.map((p) => p.name));
A.check('web-created RTL and emoji names are stored byte-for-byte (read back through the API)', names.has(RTL) && names.has(EMOJI), { rtl: names.has(RTL), emoji: names.has(EMOJI) });
const createAction = createEntry[1];
const hdrs = Object.fromEntries(Object.entries(createAction.headers).filter(([k]) => !['cookie', 'content-length', 'content-type', 'host'].includes(k)));
const original = createAction.body.toString('latin1');
const boundary = createAction.headers['content-type'].split('boundary=')[1];
function craft(fields) {
  const parts = original.split('--' + boundary).filter((p) => p.trim() && p.trim() !== '--');
  const kept = parts.filter((p) => !/name="(_?\d+_)?name"/.test(p));
  const prefix = (parts.find((p) => /name="(_?\d+_)?name"/.test(p)) || '').match(/name="((_?\d+_)?)name"/)?.[1] ?? '';
  let body = '';
  for (const [k, v] of fields) body += `--${boundary}\r\nContent-Disposition: form-data; name="${prefix}${k}"\r\n\r\n${v}\r\n`;
  body += kept.map((p) => '--' + boundary + p).join('');
  return Buffer.concat([Buffer.from(body.replace(/\r\n$/, '') + '\r\n', 'latin1'), Buffer.from('--' + boundary + '--\r\n')]);
}
async function direct(label, fields, raw, expect, ctype) {
  const data = raw ?? craft(fields.map(([k, v]) => [k, Buffer.from(v, 'utf8').toString('latin1')]));
  const r = await ctx.request.post(createAction.url, { headers: { ...hdrs, 'content-type': ctype ?? 'multipart/form-data; boundary=' + boundary }, data, maxRedirects: 0, timeout: 60000 });
  const t = await r.text(); const result = (t.match(/\{"status":"(?:error|success)"[^}]*\}/) || [null])[0];
  rows.push({ layer: 'web-action-direct', label, status: r.status(), result });
  const fieldErr = result && /"status":"error"/.test(result);
  if (expect === 'ok') A.check(`web action endpoint ${label}: success`, r.status() === 200 && /"status":"success"/.test(result || ''), { status: r.status(), result });
  else A.check(`web action endpoint ${label}: 4xx or inline field error, never 5xx`, r.status() < 500 && (r.status() >= 400 || fieldErr), { status: r.status(), result });
}
await direct('control valid', [['name', 'direct-ok']], undefined, 'ok');
await direct('name of 101 chars', [['name', 'a'.repeat(101)]]);
await direct('whitespace only', [['name', '   ']]);
await direct('NUL byte', [['name', 'a\u0000b']]);
await direct('missing name', []);
await direct('two name fields', [['name', 'one'], ['name', 'two']]);
await direct('unknown extra field and ownerId', [['name', 'direct-extra'], ['extra', '1'], ['ownerId', 'bob']]);
await direct('name of 900 KB', [['name', 'x'.repeat(900 * 1024)]]);
await direct('name of 2 MB (over the 1 MB action limit)', [['name', 'x'.repeat(2 * 1024 * 1024)]]);
await direct('garbage body', [], Buffer.from('not multipart at all'));
await direct('RTL override', [['name', RTL]], undefined, 'ok');
await direct('emoji with ZWJ', [['name', EMOJI]], undefined, 'ok');
async function chunked(label, data, ctype) {
  const cookie = (await ctx.cookies(BASE)).map((c) => c.name + '=' + c.value).join('; ');
  const u = new URL(createAction.url);
  const res = await new Promise((resolve) => {
    const rq = httpRequest({ host: '127.0.0.1', port: Number(u.port), path: u.pathname, method: 'POST', headers: { ...hdrs, host: u.host, cookie, 'content-type': ctype ?? 'multipart/form-data; boundary=' + boundary, 'transfer-encoding': 'chunked' } }, (r) => { let t = ''; r.on('data', (d) => (t += d)); r.on('end', () => resolve({ status: r.statusCode })); });
    rq.on('error', (e) => resolve({ status: 'socket-error ' + e.code })); rq.setTimeout(30000, () => rq.destroy());
    for (let i = 0; i < data.length; i += 65536) rq.write(data.subarray(i, i + 65536));
    rq.end();
  });
  rows.push({ layer: 'web-action-direct', label, status: res.status });
  A.check(`web action endpoint ${label}: 4xx (no content-length), never 5xx`, typeof res.status === 'number' && res.status >= 400 && res.status < 500, res);
}
await chunked('name of 2 MB, chunked', craft([['name', 'x'.repeat(2 * 1024 * 1024)]]));
await chunked('name of 900 KB, chunked', craft([['name', 'y'.repeat(900 * 1024)]]));
await chunked('garbage multipart, chunked', Buffer.from('not multipart at all'));
await direct('text/plain body to the action', [], Buffer.from('name=direct-textplain'), undefined, 'text/plain');
await direct('application/json body to the action', [], Buffer.from('{"name":"direct-json"}'), undefined, 'application/json');
await browser.close();
writeFileSync(OUT + '/ids.json', JSON.stringify({ createId: createEntry[0], renameId: renameEntry[0], pid: renamePid }));
writeFileSync(OUT + '/core-rows.json', JSON.stringify(rows, null, 1));
A.finish();
