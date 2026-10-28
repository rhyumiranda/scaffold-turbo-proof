// z2 own API crafted shapes against the production API (:4103): raw HTTP so odd headers/bodies are sent as-is. Any 5xx flagged.
import { writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { gzipSync, deflateSync } from 'node:zlib';
const env = process.env, out = env.OUT;
let tok, tokAt = 0;
async function mint() { tok = (await (await fetch('http://localhost:8080/realms/acme-z5/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'acme-cli', client_secret: env.ACME_CLI_SECRET, username: 'alice', password: env.ALICE_PASSWORD }) })).json()).access_token; tokAt = Date.now(); }
await mint();
const rows = []; let bad = 0;
function raw(method, path, headers, body, chunked = false) {
  path = path.replace(/[^\x21-\x7e]/g, (c) => encodeURIComponent(c));
  return new Promise((resolve) => {
    const buf = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const h = { host: '127.0.0.1:4103', authorization: 'Bearer ' + tok, ...headers };
    if (buf && !chunked && h['content-length'] === undefined) h['content-length'] = buf.length;
    if (chunked) h['transfer-encoding'] = 'chunked';
    for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
    const rq = httpRequest({ host: '127.0.0.1', port: 4103, path, method, headers: h, insecureHTTPParser: false }, (r) => { let t = ''; r.on('data', (d) => (t += d)); r.on('end', () => resolve({ status: r.statusCode, ct: r.headers['content-type'], ra: r.headers['retry-after'], t })); });
    rq.on('error', (e) => resolve({ status: 'socket-error ' + e.code, t: '' }));
    rq.setTimeout(20000, () => { rq.destroy(); resolve({ status: 'timeout', t: '' }); });
    if (buf) { if (chunked) { for (let i = 0; i < buf.length; i += 65536) rq.write(buf.subarray(i, i + 65536)); rq.end(); } else rq.end(buf); } else rq.end();
  });
}
const R = async (label, method, path, headers, body, chunked) => {
  if (Date.now() - tokAt > 30000) await mint();
  let res = await raw(method, path, headers, body, chunked);
  for (let i = 0; i < 12 && res.status === 429; i++) { await new Promise((r) => setTimeout(r, Number(res.ra || 5) * 1000 + 200)); if (Date.now() - tokAt > 30000) await mint(); res = await raw(method, path, headers, body, chunked); res.retried = i + 1; }
  const is5 = typeof res.status !== 'number' || res.status >= 500;
  if (is5) bad++;
  let j; try { j = JSON.parse(res.t); } catch {}
  const row = { retried: res.retried, label, method, path: path.slice(0, 70), status: res.status, ct: res.ct?.split(';')[0], code: j?.code, flag: is5 ? '5XX/ERR' : undefined, excerpt: res.t.slice(0, 80).replace(/\s+/g, ' ') };
  rows.push(row); if (is5) console.log(JSON.stringify(row)); return { res, j };
};
const J = { 'content-type': 'application/json' };
const seed = await R('seed create', 'POST', '/v1/projects', J, JSON.stringify({ name: 'z2-api-seed' }));
const id = seed.j.id;
const nest = (n, leaf = '1') => '['.repeat(n) + leaf + ']'.repeat(n);
const bodies = {
  dupName: '{"name":"a","name":"b"}', protoKey: '{"__proto__":{"x":1},"name":"a"}', protoName: '{"name":"a","__proto__":"x"}', ctorKey: '{"constructor":{"prototype":{"x":1}},"name":"a"}', bom: '﻿{"name":"a"}', nulKey: '{"na\\u0000me":"a"}', lone: '{"name":"\\ud800"}', lone2: '{"name":"\\udc00x"}',
  bigNum: '{"name":1e999}', nameBigObj: '{"name":{"a":' + nest(40) + '}}', nameStr1M: JSON.stringify({ name: 'x'.repeat(1024 * 1024 - 20) }), over1M: JSON.stringify({ name: 'x'.repeat(1024 * 1024 + 10) }), nameSurrogatePairs: JSON.stringify({ name: '😀'.repeat(60) }), name101emoji: JSON.stringify({ name: '😀'.repeat(101) }), name100emoji: JSON.stringify({ name: '😀'.repeat(100) }),
  combining: JSON.stringify({ name: 'é'.repeat(60) }), zwsp: JSON.stringify({ name: '​​' }), nbsp: JSON.stringify({ name: '  ' }), ctrl: JSON.stringify({ name: 'a\u0007b' }), del: JSON.stringify({ name: 'a\u007fb' }), c1: JSON.stringify({ name: 'a\u0085b' }), lsep: JSON.stringify({ name: 'a b' }), bidi: JSON.stringify({ name: '‮abc‬' }), tagchars: JSON.stringify({ name: 'a\u{e0041}b' }), nonchar: JSON.stringify({ name: 'a￾b￿' }),
  trimmed: JSON.stringify({ name: '  pad  ' }), arrayBody: '[{"name":"a"}]', nestedObjName: '{"name":{"first":"a"}}', boolName: '{"name":true}', emptyName: '{"name":""}', nullBody: 'null', numBody: '5', trueBody: 'true', emptyBody: '', wsBody: '   ', trailingGarbage: '{"name":"a"}x', twoDocs: '{"name":"a"}{"name":"b"}', single: "{'name':'a'}", deep3k: '{"a":'.repeat(3000) + '1' + '}'.repeat(3000), deep100k: nest(100000), wideObj: '{' + Array.from({ length: 50000 }, (_, i) => `"k${i}":${i}`).join(',') + '}', wideArr: '[' + '0,'.repeat(300000) + '0]', manyKeysPlusName: '{"name":"a",' + Array.from({ length: 20000 }, (_, i) => `"k${i}":1`).join(',') + '}',
  ev_str: '{"name":"a","expectedVersion":"1"}', ev_neg: '{"name":"a","expectedVersion":-1}', ev_nan: '{"name":"a","expectedVersion":NaN}',
};
for (const [n, b] of Object.entries(bodies)) {
  await R('POST ' + n, 'POST', '/v1/projects', J, b);
  await R('PATCH ' + n, 'PATCH', '/v1/projects/' + id, J, b);
  await R('POST chunked ' + n, 'POST', '/v1/projects', J, b, true);
}
for (const v of ['1', '1.0', '1e0', '2147483647', '2147483648', '9007199254740993', '-0', '0', '1e999', 'null', 'true', '[]', '{}', '"1"']) await R('PATCH expectedVersion=' + v, 'PATCH', '/v1/projects/' + id, J, `{"name":"v${v.length}","expectedVersion":${v}}`);
for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/json; charset=utf-16', 'application/json; charset=latin1', 'application/json;charset=', 'application/json; charset=bogus', 'application/jsonx', 'application/vnd.api+json', 'application/json, text/plain', 'APPLICATION/JSON', '', 'application/*', null, 'x'.repeat(10000)]) {
  await R('POST content-type=' + String(ct).slice(0, 40), 'POST', '/v1/projects', { 'content-type': ct }, '{"name":"ct"}');
}
for (const enc of ['gzip', 'deflate', 'br', 'identity', 'zzz', 'gzip, gzip', 'GZIP', 'gzip, deflate']) {
  await R('POST content-encoding=' + enc + ' valid gzip', 'POST', '/v1/projects', { ...J, 'content-encoding': enc }, gzipSync('{"name":"enc"}'));
  await R('POST content-encoding=' + enc + ' plain body', 'POST', '/v1/projects', { ...J, 'content-encoding': enc }, '{"name":"enc"}');
  await R('POST content-encoding=' + enc + ' deflate', 'POST', '/v1/projects', { ...J, 'content-encoding': enc }, deflateSync('{"name":"enc"}'));
}
await R('POST gzip bomb 200MB', 'POST', '/v1/projects', { ...J, 'content-encoding': 'gzip' }, gzipSync(Buffer.from('{"name":"' + 'a'.repeat(200 * 1024 * 1024) + '"}'), { level: 9 }));
await R('POST gzip truncated', 'POST', '/v1/projects', { ...J, 'content-encoding': 'gzip' }, gzipSync('{"name":"enc"}').subarray(0, 12));
await R('POST invalid utf8 body', 'POST', '/v1/projects', J, Buffer.concat([Buffer.from('{"name":"'), Buffer.from([0xff, 0xfe, 0xc0, 0x80]), Buffer.from('"}')]));
await R('POST utf-16 body', 'POST', '/v1/projects', { 'content-type': 'application/json; charset=utf-16le' }, Buffer.from('{"name":"a"}', 'utf16le'));
const queries = ['limit=', 'limit=0', 'limit=-1', 'limit=1.5', 'limit=0x10', 'limit=%00', 'limit=%ZZ', 'limit[]=1', 'limit[a]=1', 'limit=1&limit=2&limit=3', 'LIMIT=5', 'offset=1.5', 'offset=1e3', 'offset=2147483648', 'offset=9007199254740993', 'offset=-0', 'offset=%20', 'limit=%EF%BC%91', 'limit=1&offset=', 'cursor=x', 'cursor=' + 'a'.repeat(50000), 'sort=name', 'q=' + 'a'.repeat(100000), 'limit=100&offset=99999999', '%', '?', 'a=b&&&=', 'limit=1;offset=2', 'limit=١٢'];
for (const q of queries) await R('GET ?' + q.slice(0, 40), 'GET', '/v1/projects?' + q, {});
for (const p of ['/v1/projects/%00', '/v1/projects/..%2f..%2fetc', '/v1/projects/' + id + '/', '/v1/projects/' + id.toUpperCase(), '/v1/projects/' + id + '%00', '/v1/projects/%ZZ', '/v1/projects/' + 'a'.repeat(100000), '/v1/projects/00000000-0000-0000-0000-000000000000', '/v1/projects/' + id + '?x=' + 'y'.repeat(10000), '/v1//projects', '/v1/projects//', '/v1/projects/%2e%2e', '/v1/projects/;a=b', '/v1/projects/' + encodeURIComponent('😀'), '/v1/projects/%F0%28%8C%28', '/v1/projects/*', '/%', '/v1/%']) {
  await R('GET ' + p.slice(0, 50), 'GET', p, {});
  await R('PATCH ' + p.slice(0, 50), 'PATCH', p, J, '{"name":"x","expectedVersion":1}');
}
for (const m of ['PUT', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'PROPFIND', 'CONNECT']) for (const p of ['/v1/projects', '/v1/projects/' + id]) await R(m + ' ' + p.slice(0, 30), m, p, J, m === 'PUT' || m === 'DELETE' ? '{"name":"x"}' : undefined);
for (const [label, h] of Object.entries({ cl_abc: { 'content-length': 'abc' }, cl_neg: { 'content-length': '-1' }, cl_huge: { 'content-length': '99999999999999999999' }, cl_short: { 'content-length': '3' }, longhdr: { 'x-pad': 'a'.repeat(30000) }, hugehdr: { 'x-pad': 'a'.repeat(200000) }, authLong: { authorization: 'Bearer ' + 'a'.repeat(50000) }, authBin: { authorization: 'Bearer ÿþ' }, authMulti: { authorization: 'Bearer a, Bearer b' }, accept_bad: { accept: 'x/;;;' }, accept_lang: { 'accept-language': 'x'.repeat(10000) }, reqid_long: { 'x-request-id': 'a'.repeat(10000) }, reqid_nul: { 'x-request-id': 'a\tb' }, traceparent_bad: { traceparent: 'zz-zz' }, 'if-none-match': { 'if-none-match': '*' }, range: { range: 'bytes=0-1,5-9,11-' }, expect: { expect: '100-continue' }, hostbad: { host: 'x'.repeat(10000) }, cookie_bad: { cookie: '%=;;;=' } })) {
  await R('POST header ' + label, 'POST', '/v1/projects', { ...J, ...h }, '{"name":"hdr"}');
  await R('GET header ' + label, 'GET', '/v1/projects', h);
}
await R('POST no auth', 'POST', '/v1/projects', { ...J, authorization: null }, '{"name":"x"}');
await R('POST chunked + content-length 0', 'POST', '/v1/projects', { ...J, 'content-length': '0' }, undefined);
writeFileSync(out + '/results-h.json', JSON.stringify(rows));
const by = {}; for (const r of rows) by[r.status] = (by[r.status] || 0) + 1;
const non4 = rows.filter((r) => typeof r.status === 'number' && r.status < 400).map((r) => `${r.status} ${r.label}`);
console.log(JSON.stringify({ total: rows.length, bad, byStatus: by }));
console.log('2xx/3xx rows:\n' + non4.join('\n'));
