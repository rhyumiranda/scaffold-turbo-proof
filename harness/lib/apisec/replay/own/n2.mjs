// z5 NEW attacks N2: both action ids x argument structures x ids x routes x body sizes, with and without session. Raw TCP.
import { capture, Tally, rq } from './z5lib.mjs';
const c = await capture();
const T = new Tally('n2-actions');
const show = process.env.SHOW === '1';
const run = async (label, buf, o) => { const r = await T.run(label, buf, o); if (show) console.log(String(r.status).padEnd(5), label); return r; };
const UUID = '00000000-0000-4000-8000-000000000000';
const O = 'http://localhost:3103';
const mp = (parts, b = 'BB') => parts.map(([n, v]) => `--${b}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`).join('') + `--${b}--\r\n`;
const post = (id, body, extra = {}, target = '/projects') => rq({ method: 'POST', target, h: { Origin: O, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'multipart/form-data; boundary=BB', 'Next-Action': id, ...extra }, body: Buffer.from(body, 'utf8') });
const idle = '{"status":"idle","message":""}';
const ids = { create: c.createId, rename: c.renameId };
const authed = [{}, { Cookie: c.cookie }];

// ---- N2a: argument structures in field 0
const big = (n) => '"' + 'a'.repeat(n) + '"';
const nest = (n, open = '[', close = ']') => open.repeat(n) + close.repeat(n);
const objNest = (n) => '{"a":'.repeat(n) + '1' + '}'.repeat(n);
const argsets = [
  '[]', '[null]', '[1]', '[-0]', '[1e999]', '[-1e999]', '[1e-999]', '[123456789012345678901234567890]', '[0.1]', '[true]', '[false]', '["x"]', '[""]', '["$$"]', '["$$$$"]', '["$$K1"]', '["$undefined"]', '["$K1"]', '["$K1","$K1"]', '["$K1","$K1","$K1"]',
  '["$undefined","$K1"]', '[null,"$K1"]', '[1,"$K1"]', '["x","$K1"]', '[[],"$K1"]', '[{},"$K1"]', `[${idle},"$K1"]`, `[${idle},"$K1","extra"]`, `[${idle},"$K1",null,null]`, '["$K0"]', '["$K1"]', '["$K01"]', '["$K9999"]', '["$K' + '9'.repeat(400) + '"]', '["$K0","$K1"]', '["$K2","$K3"]', '["$K1x"]', '["$K"]', '["$K-1"]', '["$K1.5"]', '["$k1"]',
  '[{"__proto__":{"polluted":1}},"$K1"]', '[{"constructor":{"prototype":{"polluted":1}}},"$K1"]', '[{"then":1},"$K1"]', '[{"toString":1},"$K1"]', '[{"$":1},"$K1"]', '[{"$K1":1},"$K1"]', '[{"$$":1},"$K1"]', '[{"":1},"$K1"]', '[{"a":{"b":{"c":null}}},"$K1"]', '[{"status":"idle","message":"","fieldError":{"x":1}},"$K1"]', '[{"status":{"x":1}},"$K1"]',
  '[[[[[[[[1]]]]]]]]', '[' + nest(31, '[', ']') + ']', '[' + nest(32, '[', ']') + ',"$K1"]', '[' + nest(33) + ']', '[' + objNest(30) + ',"$K1"]', '[' + objNest(31) + ',"$K1"]', '[' + objNest(40) + ']',
  '[' + Array(999).fill('0').join(',') + ']', '[' + Array(1000).fill('0').join(',') + ']', '[' + Array(1001).fill('0').join(',') + ']', '[' + Array(1000).fill('"$K1"').join(',') + ']', '[' + Array(500).fill('[0,0]').join(',') + ']', '[' + Array(2000).fill('{"a":1}').join(',') + ']',
  '[' + big(1000) + ',"$K1"]', '[' + big(100000) + ',"$K1"]', '[' + big(900000) + ',"$K1"]', '[' + '"$$' + 'a'.repeat(50000) + '","$K1"]', '["\\u0000","$K1"]', '["\\ud800","$K1"]', '["\\udc00\\ud800","$K1"]', '["\\u2028\\u2029","$K1"]', '["\\ufeff","$K1"]', '["\\ufffe\\uffff","$K1"]', '["😀","$K1"]', '["\\ud83d\\ude00","$K1"]', '["\\u0024K1"]', '["\\u0024undefined"]', '["\\u0024\\u0024"]', '["$\\u004B1"]',
  '{"0":["$K1"]}', '{}', '"$K1"', '"x"', '1', 'null', 'true', '[,]', '[1,]', '[1 2]', '[01]', '[+1]', '[.5]', '[1.]', '[NaN]', '[Infinity]', "['a']", '[undefined]', '[// c\n1]', '[/* c */1]', '[1]x', ' [1] ', '﻿[1]', '[1]\u0000', '\u0000', '[' , ']', '', ' ', '[]]', '[[]', '["\\x"]', '["\\"', '["\n"]', '["\t"]',
  '[{"a":1,"a":2},"$K1"]', '[{"a":1},"$K1"]'.repeat(2), '["$@1"]', '["$F1"]', '["$Q1"]', '["$W1"]', '["$B1"]', '["$h"]', '["$Z"]', '["$-0"]', '["$Infinity"]', '["$-Infinity"]', '["$NaN"]', '["$n1"]', '["$D2020"]', '["$T"]', '["$S"]', '["$s"]', '["$i"]', '["$u"]',
];
for (const [name, id] of Object.entries(ids)) for (const a of argsets) for (const ck of authed) {
  const withName = name === 'create' ? [['_1_name', 'n2-arg'], ['0', a]] : [['_1_name', 'n2-arg'], ['_1_expectedVersion', '1'], ['0', a]];
  await run(`${name} 0=${a.slice(0, 70).replace(/\n/g, ' ')} ${ck.Cookie ? 'authed' : 'anon'}`, post(id, mp(withName), ck));
  if (a.length < 5000) await run(`${name} 0-first 0=${a.slice(0, 50).replace(/\n/g, ' ')} ${ck.Cookie ? 'authed' : 'anon'}`, post(id, mp([['0', a], ...withName.slice(0, -1)]), ck));
}

// ---- N2b: rename with every id / version / name shape, cookie present (bound id is attacker controlled)
const pidU = c.pid;
const renameIds = [pidU, pidU.toUpperCase(), '{' + pidU + '}', pidU + ' ', ' ' + pidU, pidU + '\n', pidU.replace(/-/g, ''), 'urn:uuid:' + pidU, UUID, 'ffffffff-ffff-ffff-ffff-ffffffffffff', '00000000-0000-0000-0000-000000000000', '../' + pidU, pidU + '/../' + pidU, pidU + '?x=1', pidU + '#', pidU + '%00', pidU + '\u0000', "'; drop table projects;--", 'x', '', ' ', 'a'.repeat(200), 'a'.repeat(100000), '😀', '‮' + pidU, pidU + '/extra', '%2e%2e%2f', '%', '\\', 'null', 'undefined', '__proto__', '[]'];
const vers = ['1', '2', '0', '-1', '1.5', '1e3', '0x10', '2147483647', '2147483648', '99999999999999999999', 'NaN', 'Infinity', '', ' ', 'x', '１', '١', '1\u0000', '+1', '1 ', '01'];
const names = ['ok', 'a'.repeat(100), 'a'.repeat(101), '   ', '', 'a\u0000b', '‮abc', '😀'.repeat(50), '😀'.repeat(51), '\ud83d'.length ? 'é'.repeat(60) : '', '​', ' ', '﻿', '<script>alert(1)</script>', '"; DROP TABLE projects; --', '${7*7}', '{{7*7}}', '../../x', 'a\r\nb', 'a\tb', '\u0085', '᠎', 'ａｂｃ', '\u{10ffff}', '￿', '￾'];
for (const id of renameIds) await run(`rename bound-id ${JSON.stringify(id).slice(0, 50)}`, post(c.renameId, mp([['_1_name', 'n2-rid'], ['_1_expectedVersion', '1'], ['0', JSON.stringify([id, JSON.parse(idle), '$K1'])]]), { Cookie: c.cookie }, '/projects/' + pidU));
for (const v of vers) await run(`rename expectedVersion ${JSON.stringify(v)}`, post(c.renameId, mp([['_1_name', 'n2-ver'], ['_1_expectedVersion', v], ['0', JSON.stringify([pidU, JSON.parse(idle), '$K1'])]]), { Cookie: c.cookie }, '/projects/' + pidU));
for (const n of names) {
  await run(`rename name ${JSON.stringify(n).slice(0, 40)}`, post(c.renameId, mp([['_1_name', n], ['_1_expectedVersion', '1'], ['0', JSON.stringify([pidU, JSON.parse(idle), '$K1'])]]), { Cookie: c.cookie }, '/projects/' + pidU));
  await run(`create name ${JSON.stringify(n).slice(0, 40)}`, post(c.createId, mp([['_1_name', n], ['0', JSON.stringify([JSON.parse(idle), '$K1'])]]), { Cookie: c.cookie }));
}
for (const f of ['_1_name', '_1_expectedVersion', '_2_name', '_1_id', '_1_Name', '_1_name2', '_10_name', '_9999_name', '_1_', '_0_name', '$ACTION_ID_x', '$ACTION_REF_1', '_1_' + 'a'.repeat(64), '_1_' + 'a'.repeat(65), 'name', '1_name', '__proto__', '_1___proto__']) {
  await run(`extra field ${f.slice(0, 30)} create`, post(c.createId, mp([['_1_name', 'n2-ef'], [f, 'v'], ['0', JSON.stringify([JSON.parse(idle), '$K1'])]]), { Cookie: c.cookie }));
  await run(`extra field ${f.slice(0, 30)} rename`, post(c.renameId, mp([['_1_name', 'n2-ef'], ['_1_expectedVersion', '1'], [f, 'v'], ['0', JSON.stringify([pidU, JSON.parse(idle), '$K1'])]]), { Cookie: c.cookie }, '/projects/' + pidU));
}

// ---- N2c: body sizes around every limit (proxy 1 MiB check, framework 1 MB action limit, field sizes)
for (const [name, id] of Object.entries(ids)) for (const total of [1048000, 1048400, 1048500, 1048560, 1048570, 1048575, 1048576, 1048577, 1048600, 1100000, 2097152, 10485760, 10485761, 20000000]) {
  const fixed = Buffer.byteLength(mp([['_1_name', ''], ['0', JSON.stringify([JSON.parse(idle), '$K1'])]]));
  const pad = Math.max(0, total - fixed);
  const body = mp([['_1_name', 'a'.repeat(pad)], ['0', JSON.stringify([JSON.parse(idle), '$K1'])]]);
  await run(`${name} body ${Buffer.byteLength(body)} bytes (name ${pad})`, post(id, body, { Cookie: c.cookie }), { timeout: 20000 });
}
for (const n of [1000, 65535, 65536, 100000, 500000, 1000000]) {
  await run(`create 0 field ${n} bytes`, post(c.createId, mp([['_1_name', 'z'], ['0', JSON.stringify([{ status: 'idle', message: 'm'.repeat(n) }, '$K1'])]]), { Cookie: c.cookie }), { timeout: 20000 });
}
for (const n of [50, 500, 5000, 9999, 10000, 10001]) {
  await run(`create ${n} form fields`, post(c.createId, mp([['_1_name', 'z'], ...Array.from({ length: n }, (_, i) => [`_${(i % 9999) + 1}_f${i}`, 'v']), ['0', JSON.stringify([JSON.parse(idle), '$K1'])]]), { Cookie: c.cookie }), { timeout: 20000 });
}

// ---- N2d: Next-Action header shapes on routes
const good = mp([['_1_name', 'n2-route'], ['0', JSON.stringify([JSON.parse(idle), '$K1'])]]);
const actionIds = [c.createId, c.renameId, c.createId.toUpperCase(), c.createId.slice(0, -1), c.createId + '0', c.createId + c.createId, '0'.repeat(42), '0'.repeat(40), 'f'.repeat(42), '0'.repeat(200), '0'.repeat(5000), '', ' ', 'x', '..', '../../etc/passwd', '%', '%00', '0x' + '0'.repeat(40), '__proto__', 'constructor', 'null', '-1', '😀', c.createId + ',' + c.renameId, c.createId + ', ' + c.renameId, c.createId + ' ' + c.renameId, c.createId + ';x', c.createId + '\t'];
const routes = ['/', '/projects', '/projects/' + pidU, '/projects/' + UUID, '/projects/not-a-uuid', '/signed-out', '/sign-in-problem', '/nope', '/_not-found', '/healthz', '/auth/login', '/auth/logout', '/auth/refresh', '/auth/callback', '/auth/nope', '/_next/static/x.js', '/_next/image?url=/', '/favicon.ico', '/projects/%2e%2e', '/projects/%00', '/projects?a=1', '/projects//', '/projects/'];
for (const id of actionIds) for (const r of routes) await run(`action id ${JSON.stringify(id).slice(0, 30)} -> ${r}`, post(id, good, { Cookie: c.cookie }, r));
for (const r of routes) for (const ck of authed) {
  for (const [ct, body] of [['text/plain', '["$K1"]'], ['application/json', '["$K1"]'], ['application/x-www-form-urlencoded', '0=%5B%22%24K1%22%5D&_1_name=x'], ['application/x-www-form-urlencoded', '$ACTION_ID_' + c.createId + '=&_1_name=x'], ['multipart/form-data', good], ['multipart/form-data; boundary=BB', good], ['multipart/form-data; boundary="BB"', good], ['multipart/mixed; boundary=BB', good], ['', good], ['text/x-component', good]]) {
    for (const withAction of [true, false]) await run(`ct ${ct.slice(0, 30)} action=${withAction} ${r} ${ck.Cookie ? 'a' : 'x'}`, rq({ method: 'POST', target: r, h: { Origin: O, 'Sec-Fetch-Site': 'same-origin', ...(ct ? { 'Content-Type': ct } : {}), ...(withAction ? { 'Next-Action': c.createId } : {}), ...ck }, body: Buffer.from(body, 'utf8') }));
  }
}
// header duplicates on a valid write
for (const extra of [`Next-Action: ${c.createId}\r\n`, `Next-Action: x\r\n`, `Next-Action:\r\n`, `Origin: https://evil.example\r\n`, `Origin: ${O}\r\n`, `Origin: null\r\n`, `Sec-Fetch-Site: cross-site\r\n`, `Content-Type: text/plain\r\n`, `Content-Length: 5\r\n`, `Cookie: a=%\r\n`, `Host: evil.example\r\n`, `X-Forwarded-Host: evil.example\r\n`]) {
  const b = Buffer.from(good);
  const head = `POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nContent-Type: multipart/form-data; boundary=BB\r\nNext-Action: ${c.createId}\r\nCookie: ${c.cookie}\r\nContent-Length: ${b.length}\r\n${extra}\r\n`;
  await run(`dup header ${extra.trim().slice(0, 50)}`, Buffer.concat([Buffer.from(head), b]));
}
T.done();
