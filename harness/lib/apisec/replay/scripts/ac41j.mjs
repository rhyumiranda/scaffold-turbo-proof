// z5 own adversarial shapes (round 2j) against the production web (:3103). Raw TCP so every byte is under control.
// Targets: matcher-excluded paths, boundary/parser differences vs busboy, request smuggling inside multipart, methods, header tricks.
import { chromium, kcLogin } from './lib.mjs';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
const env = process.env, BASE = 'http://localhost:3103', out = env.OUT;
const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage();
await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
const caps = {};
page.on('request', (rq) => { const id = rq.headers()['next-action']; if (rq.method() === 'POST' && id && !caps[id]) caps[id] = { url: new URL(rq.url()).pathname, type: new URL(rq.url()).pathname.includes('/projects/') ? 'rename' : 'create', ct: rq.headers()['content-type'], body: rq.postData() }; });
await page.getByLabel('Project name').fill('ac41j-seed'); await page.getByRole('button', { name: 'Create project' }).click();
await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
await page.getByRole('link', { name: 'Open created project' }).click(); await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
const pid = page.url().split('/').pop();
await page.getByLabel('Project name').fill('ac41j-renamed'); await page.getByRole('button', { name: 'Save name' }).click();
await page.getByRole('status').filter({ hasText: 'Project renamed.' }).waitFor();
const cookie = (await ctx.cookies(BASE)).map((c) => c.name + '=' + c.value).join('; ');
await browser.close();
const createId = Object.keys(caps).find((k) => caps[k].type === 'create'), renameId = Object.keys(caps).find((k) => caps[k].type === 'rename');
writeFileSync(out + '/captured-browser-posts.json', JSON.stringify(caps, (k, v) => (k === 'body' && typeof v === 'string' ? v.replace(/\r\n/g, '\\r\\n').slice(0, 800) : v), 1));
console.log(JSON.stringify({ createId, renameId, pid }));

const rows = []; let bad = 0, total = 0;
function send(raw, { timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    const s = net.connect(3103, '127.0.0.1'); let buf = Buffer.alloc(0); let done = false;
    const fin = (st) => { if (done) return; done = true; s.destroy(); const text = buf.toString('latin1'); const m = /^HTTP\/1\.[01] (\d{3})/.exec(text); resolve({ status: m ? Number(m[1]) : st, head: text.slice(0, 300).replace(/\r\n/g, ' | '), body: text.slice(text.indexOf('\r\n\r\n') + 4, text.indexOf('\r\n\r\n') + 200) }); };
    s.on('connect', () => s.write(raw)); s.on('data', (d) => { buf = Buffer.concat([buf, d]); if (/^HTTP\/1\.[01] \d{3}/.test(buf.toString('latin1', 0, 16)) && buf.includes('\r\n\r\n') && buf.length > 0) { setTimeout(() => fin('ok'), 150); } });
    s.on('error', (e) => fin('socket-error ' + e.code)); s.on('close', () => fin(buf.length ? 'closed-after-data' : 'closed-no-response'));
    s.setTimeout(timeout, () => fin('timeout'));
  });
}
const B = 'xBOUNDx';
const req = ({ method = 'POST', path = '/projects', headers = {}, body = '', ct = 'multipart/form-data; boundary=' + B, action = createId, origin = true, withCookie = false, noCL = false, extraRaw = '' }) => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1' in {} ? 'utf8' : 'utf8');
  const h = { Host: 'localhost:3103', ...(origin ? { Origin: BASE, 'Sec-Fetch-Site': 'same-origin' } : {}), ...(action ? { 'Next-Action': action } : {}), ...(ct ? { 'Content-Type': ct } : {}), ...(withCookie ? { Cookie: cookie } : {}), ...headers };
  if (!noCL && h['Content-Length'] === undefined) h['Content-Length'] = String(buf.length);
  for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
  const head = `${method} ${path} HTTP/1.1\r\n` + Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n' + extraRaw + '\r\n';
  return Buffer.concat([Buffer.from(head, 'latin1'), buf]);
};
const R = async (label, opts, sendOpts) => {
  total++;
  const res = await send(req(opts), sendOpts);
  const is5 = typeof res.status === 'number' ? res.status >= 500 : !/^(closed-after-data|closed-no-response|timeout)$/.test(String(res.status));
  const flagTimeout = typeof res.status !== 'number';
  if (is5) bad++;
  const row = { label, path: opts.path ?? '/projects', method: opts.method ?? 'POST', status: res.status, flag: is5 ? '5XX/ERR' : flagTimeout ? 'NO-HTTP-RESPONSE' : undefined, excerpt: res.body.replace(/\s+/g, ' ').slice(0, 100) };
  rows.push(row); if (row.flag) console.log(JSON.stringify(row));
  return res;
};
const part = (name, value, extra = '') => `--${B}\r\nContent-Disposition: form-data; name="${name}"${extra}\r\n\r\n${value}\r\n`;
const mp = (...parts) => parts.join('') + `--${B}--\r\n`;
const good = mp(part('0', '[{"status":"idle"},"$K1"]'), part('_1_name', 'j-ok'));
const ids = { create: createId, rename: renameId, bogus: '0'.repeat(42) };

// ---- control: the exact shape a browser sends must be accepted (200) and nothing else changes
for (const [n, a] of Object.entries(ids)) for (const p of ['/projects', '/projects/' + pid]) await R(`control ${n}`, { path: p, action: a, body: good, withCookie: true });

// ---- G1: paths the proxy matcher excludes (negative lookahead is a PREFIX test): no proxy, framework decodes directly
const bypassPaths = ['/favicon.ico', '/favicon.icoX', '/favicon.ico/x', '/favicon.ico/', '/_next/static', '/_next/staticX', '/_next/static/', '/_next/static/x', '/_next/static/chunks/x.js', '/_next/image', '/_next/imageX', '/_next/image/x', '/_next/image?url=%2F&w=64&q=75', '/_next/data/x/projects.json'];
const evil = {
  b1001: mp(part('0', '[' + '0,'.repeat(1000) + '0]')),
  refMissing: mp(part('$ACTION_REF_1', ''), part('$ACTION_1:0', `{"id":"${createId}","bound":"$@2"}`)),
  refNull: mp(part('$ACTION_REF_1', ''), part('$ACTION_1:0', `{"id":"${createId}","bound":"$@1"}`), part('$ACTION_1:1', 'null')),
  deep: mp(part('0', '['.repeat(5000) + ']'.repeat(5000))),
  F1: mp(part('0', '["$F1"]')),
  noZero: mp(part('_1_name', 'x')),
  garbage: 'not multipart at all',
  good,
};
for (const p of bypassPaths) for (const [en, e] of Object.entries(evil)) for (const [an, a] of Object.entries(ids)) {
  if (an === 'bogus' && en !== 'good') continue;
  await R(`G1 bypass ${an} ${en}`, { path: p, action: a, body: e, origin: true });
  await R(`G1 bypass-noorigin ${an} ${en}`, { path: p, action: a, body: e, origin: false });
}
// x-middleware-subrequest style header bypasses (CVE-2025-29927 family)
for (const v of ['middleware', 'proxy', 'src/middleware', 'src/proxy', 'middleware:middleware:middleware:middleware:middleware', 'proxy:proxy:proxy:proxy:proxy', 'src/proxy:src/proxy:src/proxy:src/proxy:src/proxy', 'pages/_middleware'])
  for (const en of ['b1001', 'refMissing', 'garbage']) await R(`G1 x-middleware-subrequest=${v.slice(0, 20)} ${en}`, { action: createId, body: evil[en], headers: { 'x-middleware-subrequest': v }, origin: true });
for (const v of ['middleware', 'proxy:proxy:proxy:proxy:proxy']) await R('G1 subrequest evil-origin', { body: good, headers: { 'x-middleware-subrequest': v, Origin: 'https://evil.example' }, origin: false });

// ---- G2: boundary / content-type spellings
const bchars = ["a/b", 'a=b', 'a:b', 'a(b)', 'a,b', 'a?b', "a'b", 'a+b', 'a_b', 'a.b', 'a-b', 'a'.repeat(70), 'a'.repeat(71), 'a;b', 'a b', 'a"b', 'a\\b', 'a@b', 'a[b]', 'a{b}', 'a<b>'];
for (const bc of bchars) {
  const bodyFor = (b) => `--${b}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--${b}\r\nContent-Disposition: form-data; name="_1_name"\r\n\r\nx\r\n--${b}--\r\n`;
  for (const fmt of [(b) => 'multipart/form-data; boundary=' + b, (b) => 'multipart/form-data; boundary="' + b + '"', (b) => 'multipart/form-data;boundary=' + b, (b) => 'multipart/form-data; boundary=' + b + '; charset=utf-8', (b) => 'multipart/form-data; charset=utf-8; boundary=' + b, (b) => 'multipart/form-data; Boundary=' + b, (b) => 'multipart/form-data; boundary=' + b + ' ', (b) => 'multipart/form-data; boundary=' + b + ';'])
    await R(`G2 boundary ${JSON.stringify(bc).slice(0, 20)} ${fmt('B').replace('B', '')}`, { ct: fmt(bc), body: bodyFor(bc), withCookie: true });
}
for (const ct of ['multipart/form-data', 'multipart/form-data;', 'multipart/form-data; boundary=', 'multipart/form-data; boundary=""', 'multipart/form-data; boundary=a; boundary=b', 'multipart/form-data;  boundary=a', 'multipart/form-data ; boundary=a', 'multipart/form-datax; boundary=a', 'multipart/related; boundary=a', 'MULTIPART/form-data; boundary=a', 'multipart/form-data; boundary=a\u0000', 'multipart/form-data; boundary=a\t', "multipart/form-data; boundary*=utf-8''a", 'multipart/form-data; boundary=a, multipart/form-data; boundary=b', 'application/x-www-form-urlencoded', 'text/plain', 'application/json', 'text/x-component', null, ''])
  await R(`G2 ct ${String(ct).slice(0, 40)}`, { ct, body: mp(part('0', '["$K1"]')).replace(/xBOUNDx/g, 'a'), withCookie: true });

// ---- G3: smuggling / parser differences inside a well-formed browser-looking envelope
const v0 = '["$K1"]';
const smug = {
  firstCloseHidesZero: mp(part('_1_name', 'x\r\n--' + B + '--\r\nIGNORED'), part('0', v0)),
  firstCloseHidesZero2: mp(part('_1_a', 'x\r\n--' + B + '--'), part('0', v0)),
  boundaryPlusJunk: mp(part('_1_name', 'x\r\n--' + B + 'zzz'), part('0', v0)),
  boundaryPlusSpace: mp(part('_1_name', 'x\r\n--' + B + ' \r\n'), part('0', v0)),
  boundaryPlusTab: mp(part('_1_name', 'x\r\n--' + B + '\t\r\n'), part('0', v0)),
  boundaryPlusDash: mp(part('_1_name', 'x\r\n--' + B + '-\r\n'), part('0', v0)),
  boundaryPlusCR: mp(part('_1_name', 'x\r\n--' + B + '\r'), part('0', v0)),
  boundaryNoTrailing: mp(part('_1_name', 'x\r\n--' + B), part('0', v0)),
  zeroFirstThenClose: mp(part('0', v0), part('_1_name', 'x\r\n--' + B + '--\r\n--' + B + '\r\nContent-Disposition: form-data; name="0"\r\n\r\n[1]')),
  nestedCloseInZero: mp(part('0', '["$K1"]\r\n--' + B + '--'), part('_1_name', 'x')),
  epilogue: mp(part('0', v0)) + 'epilogue\r\n',
  epilogueCRLF: mp(part('0', v0)) + '\r\n',
  epilogueCRLFx2: mp(part('0', v0)) + '\r\n\r\n',
  trailingSpaceClose: `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n${v0}\r\n--${B}-- \r\n`,
  lfOnly: `--${B}\nContent-Disposition: form-data; name="0"\n\n${v0}\n--${B}--\n`,
  transportPad: `--${B} \r\nContent-Disposition: form-data; name="0"\r\n\r\n${v0}\r\n--${B}--\r\n`,
  doubleDash2: `--${B}\r\n--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n${v0}\r\n--${B}--\r\n`,
  emptyPartFirst: `--${B}\r\n\r\n\r\n--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n${v0}\r\n--${B}--\r\n`,
  zeroValueHasBoundaryLike: mp(part('0', '["$K1","--' + B + '"]')),
  zeroValueHasCRLFDashes: mp(part('0', '["$K1","\\r\\n--' + B + '"]')),
  zeroTrailingCRLF: mp(part('0', v0 + '\r\n')),
  zeroLeadingCRLF: mp(part('0', '\r\n' + v0)),
  zeroTabs: mp(part('0', '\t' + v0 + '\t')),
  fieldLongName: mp(part('0', v0), part('_1_' + 'a'.repeat(64), 'x')),
  fieldLongName2: mp(part('0', v0), part('_1_' + 'a'.repeat(65), 'x')),
  nameManyParts: mp(part('0', v0), ...Array.from({ length: 3000 }, (_, i) => part('_' + (i + 1) + '_a', 'v'))),
  nameManyParts9999: mp(part('0', v0), ...Array.from({ length: 9999 }, (_, i) => part('_' + (i + 1) + '_a', 'v'))),
  sameGroupMany: mp(part('0', v0), ...Array.from({ length: 5000 }, (_, i) => part('_1_f' + i, 'v'))),
  bigValue: mp(part('0', v0), part('_1_name', 'x'.repeat(1024 * 1024 - 400))),
  bigValueOver: mp(part('0', v0), part('_1_name', 'x'.repeat(1024 * 1024))),
  bigZero: mp(part('0', '[' + '"a",'.repeat(150000) + '"$K1"]')),
  zero1000: mp(part('0', '[' + '1,'.repeat(999) + '"$K1"]'), part('_1_name', 'x')),
  zero1000str: mp(part('0', '[' + '"$$",'.repeat(999) + '"$K1"]')),
  zeroKbig: mp(part('0', '["$K' + '9'.repeat(5000) + '"]')),
  zeroKmany: mp(part('0', '[' + '"$K1",'.repeat(999) + '"$K1"]'), part('_1_name', 'x')),
  zeroKnone: mp(part('0', '["$K2"]'), part('_1_name', 'x')),
  zeroKzero: mp(part('0', '["$K0"]')),
  zeroUndef: mp(part('0', '["$undefined"]')),
  zeroObjKeys: mp(part('0', '[{"$K1":1,"$$":2,"$":3,"__proto__":{"a":1},"constructor":4,"toString":5},"$K1"]'), part('_1_name', 'x')),
  zeroUnicodeKeys: mp(part('0', '[{"\\u0000":1,"\\ud800":2},"$K1"]'), part('_1_name', 'x')),
  zeroNums: mp(part('0', '[1e999,-1e999,1e-999,0.1,-0,123456789012345678901234567890,"$K1"]'), part('_1_name', 'x')),
  zeroEscapedDollar: mp(part('0', '["\\u0024F1","\\u0024K1"]'), part('_1_name', 'x')),
  zeroHugeString: mp(part('0', '["' + 'x'.repeat(900000) + '"]')),
  zeroDepth32: mp(part('0', '['.repeat(31) + ']'.repeat(31))),
  zeroDepth33: mp(part('0', '['.repeat(32) + ']'.repeat(32))),
  zeroObjDepth32: mp(part('0', '[' + '{"a":'.repeat(31) + '1' + '}'.repeat(31) + ']')),
  zero10001nodes: mp(part('0', '[' + '[],'.repeat(9990) + '[]]')),
  zeroBigObjKeys: mp(part('0', '[{' + Array.from({ length: 9000 }, (_, i) => `"k${i}":1`).join(',') + '}]')),
  zeroDupKeys: mp(part('0', '[{"a":1,"a":2}]')),
  zeroLoneSurrogateRaw: Buffer.concat([Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["`), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from(`"]\r\n--${B}--\r\n`)]),
  zeroOverlong: Buffer.concat([Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["`), Buffer.from([0xc0, 0x80]), Buffer.from(`"]\r\n--${B}--\r\n`)]),
  zeroBOM: mp(part('0', '﻿' + v0)),
  nameValueNul: mp(part('0', v0), part('_1_name', 'a\u0000b')),
  nameValueInvalidUtf8: Buffer.concat([Buffer.from(mp(part('0', v0))).subarray(0, Buffer.from(mp(part('0', v0))).length - (`--${B}--\r\n`).length), Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="_1_name"\r\n\r\n`), Buffer.from([0xff, 0xfe]), Buffer.from(`\r\n--${B}--\r\n`)]),
  dispositionCase: mp(part('0', v0)).replace('Content-Disposition: form-data', 'CONTENT-DISPOSITION: FORM-DATA'),
  dispositionSpaces: mp(part('0', v0)).replace('form-data; name', 'form-data;  name'),
  dispositionNoSpace: mp(part('0', v0)).replace('form-data; name', 'form-data;name'),
  dispositionTabSep: mp(part('0', v0)).replace('Disposition: form', 'Disposition:\tform'),
  dispositionTrailingSemicolon: mp(part('0', v0, ';')),
  dispositionTrailingSpace: mp(part('0', v0, ' ')),
  dispositionExtraParam: mp(part('0', v0, '; foo=bar')),
  dispositionFilename: mp(part('0', v0, '; filename="a"')),
  dispositionFilenameStar: mp(part('0', v0, "; filename*=utf-8''a")),
  dispositionNameUpperCase: mp(part('0', v0)).replace('name="0"', 'NAME="0"'),
  dispositionNameEscaped: mp(part('0', v0)).replace('name="0"', 'name="\\0"'),
  dispositionPctName: mp(part('%30', v0)),
  dispositionPlusName: mp(part('0 ', v0)),
  dispositionNameLeadingZero: mp(part('00', v0)),
  dispositionNameFullWidth: mp(part('０', v0)),
  dispositionNameNewline: mp(part('0\n', v0)),
  twoDispositions: mp(part('0', v0)).replace('\r\n\r\n', '\r\nContent-Disposition: form-data; name="x"\r\n\r\n'),
  partCtHeader: mp(part('0', v0)).replace('\r\n\r\n', '\r\nContent-Type: text/plain\r\n\r\n'),
  partCtHeaderBeforeDisp: `--${B}\r\nContent-Type: text/plain\r\nContent-Disposition: form-data; name="0"\r\n\r\n${v0}\r\n--${B}--\r\n`,
  partXHeader: mp(part('0', v0)).replace('\r\n\r\n', '\r\nX-A: b\r\n\r\n'),
  partFoldedHeader: mp(part('0', v0)).replace('; name', ';\r\n name'),
  partHeaderNoColon: mp(part('0', v0)).replace('\r\n\r\n', '\r\nfoo\r\n\r\n'),
  noBlankLine: `--${B}\r\nContent-Disposition: form-data; name="0"\r\n${v0}\r\n--${B}--\r\n`,
  headerOnlyNoValue: `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n\r\n--${B}--\r\n`,
  emptyBody: '',
  onlyClose: `--${B}--\r\n`,
  onlyOpen: `--${B}\r\n`,
  noTrailingCRLF: `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n${v0}\r\n--${B}--`,
  closeOnlyPart: `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n${v0}--${B}--`,
  dupZero: mp(part('0', v0), part('0', v0)),
  dupName: mp(part('0', v0), part('_1_name', 'a'), part('_1_name', 'b')),
  twoGroups: mp(part('0', v0), part('_1_name', 'a'), part('_2_name', 'b')),
  badNames: mp(part('0', v0), part('1_name', 'a')),
  badNames2: mp(part('0', v0), part('_0_name', 'a')),
  badNames3: mp(part('0', v0), part('_1_', 'a')),
  badNames4: mp(part('0', v0), part('_1_1a', 'a')),
  badNames5: mp(part('0', v0), part('_10000_a', 'a')),
  badNames6: mp(part('0', v0), part('$ACTION_REF_1', 'a')),
  badNames7: mp(part('0', v0), part('__proto__', 'a')),
  nonascii: mp(part('0', v0), part('_1_name', 'é😀‮')),
};
for (const [n, b] of Object.entries(smug)) for (const [an, a] of [['create', createId], ['rename', renameId]]) for (const p of ['/projects', '/projects/' + pid]) await R(`G3 ${n} ${an}`, { path: p, action: a, body: b, withCookie: true });
console.log('G1-G3 done total', total, 'bad', bad);
writeFileSync(out + '/results-j.json', JSON.stringify(rows, null, 0));
console.log(JSON.stringify({ total, bad, byStatus: rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {}) }));
