// z2 own crafted shapes for the web Server Actions: both paths (/projects, /projects/<id>, others), both action ids (create, rename), bogus ids,
// scripted (next-action) and script-free ($ACTION_*) shapes, multipart/urlencoded/text, with and without session cookie. Any 5xx is flagged.
import { chromium, kcLogin } from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { gzipSync } from 'node:zlib';
const env = process.env, BASE = 'http://localhost:3103', out = env.OUT;
const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage();
await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
const caps = {};
page.on('request', (rq) => { const id = rq.headers()['next-action']; if (rq.method() === 'POST' && id && !caps[id]) caps[id] = { url: new URL(rq.url()).pathname, type: new URL(rq.url()).pathname.includes('/projects/') ? 'rename' : 'create' }; });
await page.getByLabel('Project name').fill('ac41g-seed'); await page.getByRole('button', { name: 'Create project' }).click();
await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
await page.getByRole('link', { name: 'Open created project' }).click(); await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
const pid = page.url().split('/').pop();
const renameForm = await page.locator('form').first().evaluate((f) => [...f.querySelectorAll('input')].map((i) => ({ name: i.name, type: i.type, value: i.value.slice(0, 120) })));
writeFileSync(out + '/rename-form-inputs.json', JSON.stringify(renameForm, null, 1));
await page.getByLabel('Project name').fill('ac41g-renamed'); await page.getByRole('button', { name: 'Save name' }).click();
await page.getByRole('status').filter({ hasText: 'Project renamed.' }).waitFor();
const cookie = (await ctx.cookies(BASE)).map((c) => c.name + '=' + c.value).join('; ');
await browser.close();
const createId = Object.keys(caps).find((k) => caps[k].type === 'create'), renameId = Object.keys(caps).find((k) => caps[k].type === 'rename');
console.log(JSON.stringify({ createId, renameId, pid, renameForm }));
const rows = []; let bad = 0;
const B = '----z2boundary';
const mp = (parts, b = B) => parts.map(([k, v, extra = '']) => `--${b}\r\nContent-Disposition: form-data; name="${k}"${extra}\r\n\r\n${v}\r\n`).join('') + `--${b}--\r\n`;
function post(path, headers, body, { method = 'POST', chunked = false } = {}) {
  return new Promise((resolve) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const h = { host: 'localhost:3103', origin: BASE, 'sec-fetch-site': 'same-origin', ...headers };
    if (chunked) h['transfer-encoding'] = 'chunked'; else if (h['content-length'] === undefined) h['content-length'] = buf.length;
    for (const k of Object.keys(h)) if (h[k] === null) delete h[k];
    const rq = httpRequest({ host: '127.0.0.1', port: 3103, path, method, headers: h }, (r) => { let t = ''; r.on('data', (d) => (t += d)); r.on('end', () => resolve({ status: r.statusCode, t })); });
    rq.on('error', (e) => resolve({ status: 'socket-error ' + e.code, t: '' }));
    rq.setTimeout(20000, () => { rq.destroy(); resolve({ status: 'timeout', t: '' }); });
    if (chunked) { for (let i = 0; i < buf.length; i += 65536) rq.write(buf.subarray(i, i + 65536)); rq.end(); } else rq.end(buf);
  });
}
const R = async (label, path, headers, body, opts) => {
  const res = await post(path, headers, body, opts);
  const is5 = typeof res.status === 'number' ? res.status >= 500 : true;
  const digest = /E\{"digest"/.test(res.t);
  if (is5 || digest) bad++;
  const row = { label, path: path.replace(pid, '<id>'), status: res.status, flag: is5 ? '5XX/ERR' : digest ? 'DIGEST-ERROR-IN-BODY' : undefined, excerpt: res.t.slice(0, 100).replace(/\s+/g, ' ') };
  rows.push(row); if (row.flag) console.log(JSON.stringify(row));
  return res;
};
const mpH = (extra = {}) => ({ 'content-type': 'multipart/form-data; boundary=' + B, ...extra });
const paths = ['/projects', '/projects/' + pid, '/projects/00000000-0000-4000-8000-000000000000', '/projects/not-a-uuid', '/', '/projects?x=1', '/signed-out', '/nope', '/auth/login', '/projects/' + pid + '/', '/_next/data/x.json', '/projects//'];
const ids = { create: createId, rename: renameId, bogus42: '0'.repeat(42), bogusShort: 'ab', bogusHex40: 'a'.repeat(40), empty: '' };
const nest = (n, leaf = '"$K1"') => '['.repeat(n) + leaf + ']'.repeat(n);
const zeros = {
  ok_state_K1: '[{"status":"idle"},"$K1"]', rename_args: '[{"status":"idle"},"$K1"]', only_K1: '["$K1"]', empty_arr: '[]', obj: '{"a":1}', num: '5', nul: 'null', str: '"x"',
  proto: '[{"__proto__":{"polluted":1}},"$K1"]', ctor: '[{"constructor":{"prototype":{"p":1}}},"$K1"]', tostr: '[{"toString":"x","hasOwnProperty":1,"then":"x"},"$K1"]',
  then: '[{"then":{}},"$K1"]', big: '[1e999,-1e999,-0,9007199254740993,1.7976931348623157e308,"$K1"]', bigint: '[123456789012345678901234567890,"$K1"]',
  esc_dollar: '["\\u0024F1","$K1"]', esc_dollar2: '["\\u0024@1","$K1"]', surrogate: '["\\ud800","$K1"]', nulbyte: '["a\\u0000b","$K1"]', dollar_only: '["$","$K1"]',
  K_big: '["$K99999999999999999999"]', K_zero: '["$K0"]', K_lead: '["$K01"]', K_neg: '["$K-1"]', K_sp: '["$K 1"]', K_hex: '["$Kff"]', K_str: '["$Kx"]',
  dd: '["$$F1","$$@1","$$$K1","$K1"]', undef: '["$undefined","$K1"]', undef2: '["$undefinedx","$K1"]', nan: '["$NaN"]', inf: '["$Infinity"]', neginf: '["$-Infinity"]', negzero: '["$-0"]', date: '["$D2020-01-01"]',
  q: '["$Q1"]', B: '["$B1"]', S: '["$Sx"]', L: '["$L1"]', n: '["$n1"]', R: '["$R1"]', r: '["$r1"]', X: '["$X1"]', Y: '["$Y1"]', hash: '["$#"]', at: '["$@"]', k2: '["$k1"]', m: '["$M1"]', I: '["$i1"]', ref: '["$1"]', ref2: '["$0"]', refp: '["$1:a:b"]', refproto: '["$1:__proto__:then"]',
  deep32: nest(31), deep33: nest(32), deep34: nest(33), deep64: nest(64), deep1k: nest(1000), deep5k: nest(5000), deep200k: nest(200000),
  objdeep: '{"a":'.repeat(40) + '1' + '}'.repeat(40), objdeep10k: '[' + '{"a":'.repeat(10000) + '1' + '}'.repeat(10000) + ',"$K1"]', mixdeep: '[' + '[{"a":'.repeat(3000) + '1' + '}]'.repeat(3000) + ']',
  wide: '[' + Array.from({ length: 100000 }, (_, i) => i).join(',') + ',"$K1"]', wideobj: '[{' + Array.from({ length: 30000 }, (_, i) => `"k${i}":${i}`).join(',') + '},"$K1"]', longstr: '["' + 'x'.repeat(900 * 1024) + '","$K1"]', manyDollar: '[' + '"$$",'.repeat(50000) + '"$K1"]',
  trailing: '["$K1"] ', leadspace: ' ["$K1"]', bom: '\ufeff["$K1"]', trailingcomma: '["$K1",]', single: "['$K1']", nan2: '[NaN]', dup: '[{"a":1,"a":2},"$K1"]', comment: '["$K1"]//x', extra: '["$K1"]["$K1"]', empty: '', ws: '   ', brace: '{', garbage: '\u0000\u0001',
};
const total = { n: 0 };
// ---- scripted multipart shapes ----
for (const path of paths) {
  for (const [idn, id] of Object.entries(ids)) {
    for (const [zn, z] of Object.entries(zeros)) {
      // all combos are many; keep the full product only for the two real ids on the two real paths, sample the rest
      const real = (path === '/projects' || path === '/projects/' + pid) && (idn === 'create' || idn === 'rename');
      if (!real && !['ok_state_K1', 'deep5k', 'proto', 'K_big', 'empty_arr', 'nul', 'dup'].includes(zn)) continue;
      for (const withCookie of real ? [true, false] : [true]) {
        const h = mpH({ 'next-action': id, ...(withCookie ? { cookie } : {}) });
        await R(`scripted ${idn} ${zn} cookie=${withCookie}`, path, h, mp([['1_name', 'z2-' + zn], ['1_expectedVersion', '1'], ['0', z]]));
        total.n++;
      }
    }
  }
}
console.log('scripted multipart done', total.n, 'bad so far', bad);
// ---- scripted with other content types / wrappers ----
for (const path of paths.slice(0, 3)) for (const [idn, id] of [['create', createId], ['rename', renameId]]) {
  const base = { 'next-action': id, cookie };
  for (const [ct, body] of [
    ['text/plain;charset=UTF-8', '["$K1"]'], ['application/json', '["$K1"]'], ['application/x-www-form-urlencoded', '0=%5B%22%24K1%22%5D&1_name=x'], ['application/x-www-form-urlencoded', '0=%5B&1_name=x'],
    ['application/x-www-form-urlencoded', '%'], ['application/x-www-form-urlencoded', '%ZZ=1'], ['application/octet-stream', Buffer.from([0, 255, 254, 128])], ['text/x-component', '["$K1"]'], ['multipart/form-data', mp([['0', '[]']])], ['multipart/form-data; boundary=', mp([['0', '[]']])],
    ['multipart/form-data; boundary="' + B + '"', mp([['0', '["$K1"]'], ['1_name', 'q']])], ['multipart/form-data; boundary=' + B + '; charset=utf-16', mp([['0', '["$K1"]']])], ['multipart/mixed; boundary=' + B, mp([['0', '["$K1"]']])], ['MULTIPART/FORM-DATA; boundary=' + B, mp([['0', '["$K1"]']])],
    ['multipart/form-data; boundary=' + 'a'.repeat(200), mp([['0', '["$K1"]']], 'a'.repeat(200))], ['multipart/form-data; boundary=' + B + '; boundary=other', mp([['0', '["$K1"]']])], ['', '["$K1"]'], [null, '["$K1"]'],
  ]) await R(`scripted ${idn} content-type=${ct}`, path, { ...base, 'content-type': ct }, body);
}
// ---- multipart structure mutations (parser differences) ----
const structs = {
  noFinal: `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n`, onlyFinal: `--${B}--\r\n`, empty: '', lf: `--${B}\nContent-Disposition: form-data; name="0"\n\n["$K1"]\n--${B}--\n`,
  unquoted: `--${B}\r\nContent-Disposition: form-data; name=0\r\n\r\n["$K1"]\r\n--${B}--\r\n`, singleq: `--${B}\r\nContent-Disposition: form-data; name='0'\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
  filename0: `--${B}\r\nContent-Disposition: form-data; name="0"; filename="a.json"\r\nContent-Type: application/json\r\n\r\n["$K1"]\r\n--${B}--\r\n`, filename0b: `--${B}\r\nContent-Disposition: form-data; name="0"; filename=""\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
  nameStar: `--${B}\r\nContent-Disposition: form-data; name*=utf-8''0\r\n\r\n["$K1"]\r\n--${B}--\r\n`, dupName: `--${B}\r\nContent-Disposition: form-data; name="x"; name="0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`, nameCase: `--${B}\r\nContent-Disposition: form-data; NAME="0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
  noDisp: `--${B}\r\nContent-Type: text/plain\r\n\r\n["$K1"]\r\n--${B}--\r\n`, noName: `--${B}\r\nContent-Disposition: form-data\r\n\r\n["$K1"]\r\n--${B}--\r\n`, emptyName: `--${B}\r\nContent-Disposition: form-data; name=""\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
  attachment: `--${B}\r\nContent-Disposition: attachment; name="0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`, b64: `--${B}\r\nContent-Disposition: form-data; name="0"\r\nContent-Transfer-Encoding: base64\r\n\r\nWyIkSzEiXQ==\r\n--${B}--\r\n`,
  ctJson: `--${B}\r\nContent-Disposition: form-data; name="0"\r\nContent-Type: application/json\r\n\r\n["$K1"]\r\n--${B}--\r\n`, ctCharset: `--${B}\r\nContent-Disposition: form-data; name="0"\r\nContent-Type: text/plain; charset=utf-16le\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
  preamble: `junk\r\n--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--${B}--\r\nepilogue`, nestedMp: `--${B}\r\nContent-Disposition: form-data; name="0"\r\nContent-Type: multipart/mixed; boundary=in\r\n\r\n--in\r\n\r\n["$K1"]\r\n--in--\r\n--${B}--\r\n`,
  hugeHeader: `--${B}\r\nContent-Disposition: form-data; name="0"\r\nX-Pad: ${'a'.repeat(200000)}\r\n\r\n["$K1"]\r\n--${B}--\r\n`, manyHeaders: `--${B}\r\nContent-Disposition: form-data; name="0"\r\n${Array.from({ length: 5000 }, (_, i) => 'X-' + i + ': 1').join('\r\n')}\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
  manyParts: mp(Array.from({ length: 5000 }, (_, i) => ['f' + i, 'v'])) .replace(`--${B}--\r\n`, `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`),
  hugeName: `--${B}\r\nContent-Disposition: form-data; name="${'n'.repeat(100000)}"\r\n\r\nx\r\n--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
  zeroTwiceFile: `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--${B}\r\nContent-Disposition: form-data; name="0"; filename="a"\r\n\r\n["$F1"]\r\n--${B}--\r\n`,
  fileOnly: `--${B}\r\nContent-Disposition: form-data; name="1_name"; filename="a.txt"\r\n\r\nx\r\n--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
  bigFile: `--${B}\r\nContent-Disposition: form-data; name="1_name"; filename="a.bin"\r\n\r\n${'z'.repeat(900 * 1024)}\r\n--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
  invalidUtf8: Buffer.concat([Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="1_name"\r\n\r\n`), Buffer.from([0xff, 0xfe, 0xc0, 0x80, 0xed, 0xa0, 0x80]), Buffer.from(`\r\n--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`)]),
  invalidUtf8Zero: Buffer.concat([Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["`), Buffer.from([0xff, 0xfe]), Buffer.from(`","$K1"]\r\n--${B}--\r\n`)]),
  crlfInside: `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n[\r\n"$K1"\r\n]\r\n--${B}--\r\n`, boundaryInValue: `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["x--${B}","$K1"]\r\n--${B}--\r\n`,
  nameWithNul: `--${B}\r\nContent-Disposition: form-data; name="0\u0000"\r\n\r\n["$K1"]\r\n--${B}--\r\n`, nameSpace: `--${B}\r\nContent-Disposition: form-data; name=" 0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`, nameZeroWidth: `--${B}\r\nContent-Disposition: form-data; name="0\u200b"\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
  tab: `--${B}\r\nContent-Disposition:\tform-data;\tname="0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`, foldedHeader: `--${B}\r\nContent-Disposition: form-data;\r\n name="0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`, headerLowercase: `--${B}\r\ncontent-disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
  escapedQuote: `--${B}\r\nContent-Disposition: form-data; name="a\\"; name=\\"0"\r\n\r\n["$K1"]\r\n--${B}--\r\n`, percentName: `--${B}\r\nContent-Disposition: form-data; name="%30"\r\n\r\n["$K1"]\r\n--${B}--\r\n`,
};
for (const path of ['/projects', '/projects/' + pid]) for (const [idn, id] of [['create', createId], ['rename', renameId]]) for (const [sn, s] of Object.entries(structs)) for (const withCookie of [true, false])
  await R(`struct ${idn} ${sn} cookie=${withCookie}`, path, { 'next-action': id, 'content-type': 'multipart/form-data; boundary=' + B, ...(withCookie ? { cookie } : {}) }, s);
console.log('structs done; bad so far', bad);
// ---- script-free $ACTION_* shapes (no next-action header) ----
const bindP = (x) => JSON.stringify(x);
const mpaCases = {};
for (const [idn, id] of [['create', createId], ['rename', renameId], ['bogus', '0'.repeat(42)]]) {
  for (const bound of ['"$@1"', 'null', '"$@0"', '"$@2"', '"$@99999999999999999999"', '"$K1"', '"$F1"', '"x"', '5', '[]', '{}', 'true', '["x"]']) {
    for (const one of ['[]', '["' + pid + '"]', '[1]', '[null]', '{"a":1}', '"x"', '5', 'null', '["$$x"]', '["$K1"]', '["$undefined"]', '[["a"]]', '["$F1"]', '[["$F9"]]', '[{"x":"$@3"}]', '["$@1"]', '["$1"]', '["$1:__proto__"]', '{"__proto__":{"a":1}}', '[{"__proto__":{"a":1}}]', nest(33, '1'), nest(31, '1'), nest(5000, '1')]) {
      mpaCases[`${idn} bound=${bound} :1=${one.slice(0, 24)}`] = [['$ACTION_REF_1', ''], ['$ACTION_1:0', `{"id":"${id}","bound":${bound}}`], ['$ACTION_1:1', one], ['name', 'mpa-' + idn]];
    }
  }
}
let k = 0;
for (const [label, parts] of Object.entries(mpaCases)) {
  // full product over both real paths, with cookie; thinned for no-cookie
  for (const path of ['/projects', '/projects/' + pid]) await R('mpa ' + label, path, mpH({ cookie }), mp(parts));
  if (k++ % 5 === 0) await R('mpa nocookie ' + label, '/projects', mpH(), mp(parts));
}
console.log('mpa matrix done; bad so far', bad);
const mpaMisc = {
  idPlain: [[`$ACTION_ID_${createId}`, ''], ['name', 'ok-mpa']], idHuge: [[`$ACTION_ID_${'a'.repeat(100000)}`, '']], idNonHex: [['$ACTION_ID_zzzz', ''], ['name', 'x']], idUpper: [[`$ACTION_ID_${createId.toUpperCase()}`, ''], ['name', 'x']],
  idEmpty: [['$ACTION_ID_', ''], ['name', 'x']], idNumeric: [['$ACTION_ID_123', ''], ['name', 'x']], idTwo: [[`$ACTION_ID_${createId}`, ''], [`$ACTION_ID_${renameId}`, ''], ['name', 'x']], idValue: [[`$ACTION_ID_${createId}`, 'junk'.repeat(1000)], ['name', 'x']],
  key: [['$ACTION_KEY', 'abc'], ['name', 'x']], keyId: [['$ACTION_KEY', 'abc'], [`$ACTION_ID_${createId}`, ''], ['name', 'x']], keyHuge: [['$ACTION_KEY', 'k'.repeat(500000)], [`$ACTION_ID_${createId}`, ''], ['name', 'x']],
  refOnly: [['$ACTION_REF_1', '']], refNoNum: [['$ACTION_REF_', ''], ['$ACTION_:0', '{}']], refTwo: [['$ACTION_REF_1', ''], ['$ACTION_REF_2', ''], ['$ACTION_1:0', `{"id":"${createId}","bound":null}`], ['$ACTION_2:0', `{"id":"${renameId}","bound":"$@1"}`], ['$ACTION_2:1', `["${pid}"]`], ['name', 'x']],
  refBigN: [['$ACTION_REF_99999999999999999999', ''], ['$ACTION_99999999999999999999:0', `{"id":"${createId}","bound":null}`], ['name', 'x']], refLeadZero: [['$ACTION_REF_01', ''], ['$ACTION_01:0', `{"id":"${createId}","bound":null}`], ['name', 'x']], refMismatch: [['$ACTION_REF_1', ''], ['$ACTION_2:0', `{"id":"${createId}","bound":null}`], ['name', 'x']],
  zeroExtra: [['$ACTION_REF_1', ''], ['$ACTION_1:0', `{"id":"${createId}","bound":null,"extra":1}`], ['name', 'x']], zeroArr: [['$ACTION_REF_1', ''], ['$ACTION_1:0', '[]'], ['name', 'x']], zeroNum: [['$ACTION_REF_1', ''], ['$ACTION_1:0', '5'], ['name', 'x']], zeroNull: [['$ACTION_REF_1', ''], ['$ACTION_1:0', 'null'], ['name', 'x']], zeroIdNum: [['$ACTION_REF_1', ''], ['$ACTION_1:0', '{"id":5,"bound":null}'], ['name', 'x']], zeroNoId: [['$ACTION_REF_1', ''], ['$ACTION_1:0', '{"bound":null}'], ['name', 'x']], zeroDeep: [['$ACTION_REF_1', ''], ['$ACTION_1:0', '{"id":"x","bound":null,"d":' + nest(5000, '1') + '}'], ['name', 'x']], zeroDup: [['$ACTION_REF_1', ''], ['$ACTION_1:0', `{"id":"${createId}","bound":null}`], ['$ACTION_1:0', '{"id":"x","bound":"$F1"}'], ['name', 'x']],
  weirdKeys: [['$ACTION_REF_1', ''], ['$ACTION_1:0', `{"id":"${createId}","bound":null}`], ['$ACTION_1:x', '[]'], ['$ACTION_1:', '[]'], ['$ACTION_1:1:2', '[]'], ['$ACTION_1:-1', '["$F1"]'], ['name', 'x']],
  weirdKey2: [['$ACTION_REF_1', ''], ['$ACTION_1:0', `{"id":"${createId}","bound":null}`], ['$ACTION_X', '["$F1"]'], ['$ACTION_', '["$F1"]'], ['$ACTION_REF_x', ''], ['$ACTION_ID', ''], ['name', 'x']],
  prefixed: [['$ACTION_REF_1', ''], ['$ACTION_1:0', `{"id":"${createId}","bound":"$@1"}`], ['$ACTION_1:1', '[]'], ['$ACTION_1:2', '["$F1"]'], ['$ACTION_1:3', 'not json'], ['name', 'x']],
  onlyName: [['name', 'x']], nameDollar: [['name', '$F1']], nameFile: [['name', 'x', '; filename="a.txt"']], idFile: [[`$ACTION_ID_${createId}`, '', '; filename="a"'], ['name', 'x']], refFile: [['$ACTION_REF_1', ''], ['$ACTION_1:0', `{"id":"${createId}","bound":null}`, '; filename="a"']],
};
for (const [label, parts] of Object.entries(mpaMisc)) for (const path of ['/projects', '/projects/' + pid, '/']) for (const withCookie of [true, false]) await R(`mpa-misc ${label} cookie=${withCookie}`, path, mpH(withCookie ? { cookie } : {}), mp(parts));
// urlencoded script-free variants
const enc = (pairs) => pairs.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
const ue = { id: [[`$ACTION_ID_${createId}`, ''], ['name', 'ue']], ref: [['$ACTION_REF_1', ''], ['$ACTION_1:0', `{"id":"${createId}","bound":null}`], ['name', 'ue']], refF: [['$ACTION_REF_1', ''], ['$ACTION_1:0', `{"id":"${createId}","bound":"$@1"}`], ['$ACTION_1:1', '["$F1"]']], refDeep: [['$ACTION_REF_1', ''], ['$ACTION_1:0', `{"id":"${createId}","bound":"$@1"}`], ['$ACTION_1:1', nest(5000, '1')]], refRename: [['$ACTION_REF_1', ''], ['$ACTION_1:0', `{"id":"${renameId}","bound":"$@1"}`], ['$ACTION_1:1', `["${pid}"]`], ['name', 'ue-renamed'], ['expectedVersion', '1']], nul: [[`$ACTION_ID_${createId}`, ''], ['name', 'a\u0000b']], long: [[`$ACTION_ID_${createId}`, ''], ['name', 'x'.repeat(900000)]] };
for (const [label, pairs] of Object.entries(ue)) for (const path of ['/projects', '/projects/' + pid]) for (const withCookie of [true, false]) await R(`urlenc ${label} cookie=${withCookie}`, path, { 'content-type': 'application/x-www-form-urlencoded', ...(withCookie ? { cookie } : {}) }, enc(pairs));
for (const raw of ['%', '%ZZ', '&&&', '=', '%00=%00', '\u0000', 'a'.repeat(1000000), '%24ACTION_REF_1=&%24ACTION_1%3A0=%7B%7D', '%24ACTION_ID_=&name=x', 'name=%ff%fe']) for (const path of ['/projects', '/projects/' + pid]) await R(`urlenc raw ${raw.slice(0, 20)}`, path, { 'content-type': 'application/x-www-form-urlencoded', cookie }, raw);
console.log('mpa misc/urlenc done; bad so far', bad);
// ---- methods and transport ----
for (const method of ['PUT', 'PATCH', 'DELETE', 'POST', 'OPTIONS', 'TRACE', 'PROPFIND', 'GET', 'HEAD']) for (const path of ['/projects', '/projects/' + pid]) {
  await R(`method ${method} multipart next-action`, path, mpH({ 'next-action': createId, cookie }), mp([['0', '["$K1"]'], ['1_name', 'm']]), { method });
  await R(`method ${method} bad body next-action`, path, { 'content-type': 'text/plain', 'next-action': renameId, cookie }, '[', { method });
}
for (const chunked of [true, false]) for (const [idn, id] of [['create', createId], ['rename', renameId]]) {
  await R(`chunked=${chunked} ${idn} valid-shape`, '/projects', mpH({ 'next-action': id, cookie }), mp([['0', '[{"status":"idle"},"$K1"]'], ['1_name', 'chunk-ok']]), { chunked });
  await R(`chunked=${chunked} ${idn} 2MB name`, '/projects', mpH({ 'next-action': id, cookie }), mp([['0', '[{"status":"idle"},"$K1"]'], ['1_name', 'x'.repeat(2 * 1024 * 1024)]]), { chunked });
  await R(`chunked=${chunked} ${idn} deep`, '/projects', mpH({ 'next-action': id, cookie }), mp([['0', nest(5000)]]), { chunked });
  await R(`chunked=${chunked} ${idn} gzip body`, '/projects', mpH({ 'next-action': id, cookie, 'content-encoding': 'gzip' }), gzipSync(mp([['0', '["$K1"]']])), { chunked });
  await R(`chunked=${chunked} ${idn} gzip bad`, '/projects', mpH({ 'next-action': id, cookie, 'content-encoding': 'gzip' }), 'not gzip', { chunked });
}
for (const [label, h] of Object.entries({ cl_zero: { 'content-length': '0' }, cl_neg: { 'content-length': '-1' }, cl_abc: { 'content-length': 'abc' }, cl_huge: { 'content-length': '99999999999999999999' }, cl_over: { 'content-length': String(1024 * 1024 + 1) }, cl_exact: { 'content-length': String(1024 * 1024) }, ce_br: { 'content-encoding': 'br' }, ce_unknown: { 'content-encoding': 'zzz' }, expect: { expect: '100-continue' }, te: { te: 'trailers' }, origin_null: { origin: 'null' }, origin_bad: { origin: 'http://' }, origin_list: { origin: 'http://localhost:3103, http://evil' }, host_bad: { host: 'localhost:3103, evil' }, longhdr: { 'x-pad': 'a'.repeat(30000) }, 'next-action-multi': { 'next-action': createId + ',' + renameId }, 'next-action-empty': { 'next-action': '' }, 'next-action-long': { 'next-action': 'a'.repeat(20000) }, 'next-action-nul': { 'next-action': 'a%00b' } })) {
  for (const path of ['/projects', '/projects/' + pid]) await R(`header ${label}`, path, mpH({ 'next-action': createId, cookie, ...h }), mp([['0', '["$K1"]'], ['1_name', 'h']]));
}
writeFileSync(out + '/results-g.json', JSON.stringify(rows, null, 0));
const byStatus = {}; for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log(JSON.stringify({ total: rows.length, bad, byStatus }));
