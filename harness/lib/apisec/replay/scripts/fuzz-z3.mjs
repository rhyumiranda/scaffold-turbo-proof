// z5 structure-aware multipart fuzzer for the web Server Actions. usage: node fuzz-z5.mjs CREATE_ID RENAME_ID ITER [SEED]
// Builds bodies from delimiter-related tokens so the proxy's own parser and busboy (the framework's) are pushed to disagree.
import http from 'node:http';
import { writeFileSync } from 'node:fs';
const [create, rename, n, seedArg] = process.argv.slice(2);
let seed = Number(seedArg ?? Date.now() % 2 ** 31) >>> 0;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const ri = (k) => Math.floor(rand() * k);
const pick = (a) => a[ri(a.length)];
const agent = new http.Agent({ keepAlive: true, maxSockets: 4 });
const BASE = 'http://localhost:3103';
const bchoices = ['xBx', 'B', '----WebKitFormBoundaryAbC123xyZ', 'a'.repeat(70), 'a-b_c.d', "a'b", 'a+b', 'a/b', 'a=b', 'a:b', 'a(b)', 'a,b', 'a?b', '--', '-', 'b-', '0', '_1_', 'a b'];
const nameChoices = ['0', '0', '0', '_1_name', '_1_name', '_2_x', '_1_expectedVersion', '1_name', '$ACTION_REF_1', '$ACTION_1:0', '', '00', '_1_', '_0_a', '_1_' + 'a'.repeat(64), '_9999_a', '_10000_a', '０', '0\u0000', ' 0', '%30'];
const zeros = ['["$K1"]', '[{"status":"idle"},"$K1"]', '["$undefined","$K1"]', '[]', '{}', 'null', '[1,2,3]', '["$$a"]', '[{"a":{"b":[1,2,{"c":"$K1"}]}},"$K1"]', '["$F1"]', '["$@1"]', '[', ''];
const vals = ['x', 'hello', '', '0', '["$K1"]', '\r\n', '\r', '\n', '--', '\r\n--', '\r\n--B', '\r\n--B--', '\r\n--xBx', '\r\n--xBx--', '\r\n--xBx\r', '\r\n--xBx\r\n', '\r\n--xBx--\r\n', '\r\n--xBx \r\n', '\r\n--xBx\t\r\n', '\r\n--xBx-', '\r\n--xBx\n', '\n--xBx\n', '\r\n\r\n', '--xBx', 'é😀', '\u0000', 'a\r\nb'];
const heads = ['Content-Disposition: form-data; name="%N"', 'content-disposition: form-data; name="%N"', 'Content-Disposition: form-data; name="%N"; filename="f"', 'Content-Disposition:form-data;name="%N"', 'Content-Disposition: form-data; name=%N', 'Content-Disposition: form-data; name="%N"\r\nContent-Type: text/plain', 'Content-Type: text/plain\r\nContent-Disposition: form-data; name="%N"', 'Content-Disposition: form-data; name="%N"\r\nContent-Transfer-Encoding: base64', 'Content-Disposition: form-data;\r\n name="%N"', 'Content-Disposition: form-data; name="%N" ', 'Content-Disposition: form-data; name="%N";'];
const eols = ['\r\n', '\r\n', '\r\n', '\n', '\r', '\r\n\r\n', ''];
function build() {
  const b = rand() < 0.6 ? 'xBx' : pick(bchoices);
  const D = '--' + b;
  const parts = [];
  const np = 1 + ri(4);
  for (let i = 0; i < np; i++) {
    const name = (i === 0 && rand() < 0.5) ? '0' : (i === np - 1 && rand() < 0.6) ? '0' : rand() < 0.7 ? '_' + (i + 1) + '_' + 'f' + i : pick(nameChoices);
    const head = (rand() < 0.88 ? heads[0] : pick(heads)).replace('%N', name);
    let v = name === '0' ? (rand() < 0.8 ? zeros[0] : pick(zeros)) : (rand() < 0.45 ? 'x' : pick(vals));
    if (rand() < 0.15) v = pick(vals) + v + pick(vals);
    v = v.replace(/xBx/g, b);
    parts.push(head + (rand() < 0.97 ? '\r\n\r\n' : pick(eols) + pick(eols)) + v);
  }
  let body = '';
  const sep = () => (rand() < 0.97 ? '\r\n' : pick(eols));
  if (rand() < 0.05) body += pick(['junk\r\n', '\r\n', ' ']);
  body += D + sep();
  body += parts.join(sep() + D + sep());
  body += (rand() < 0.8 ? '\r\n' + D + '--\r\n' : pick(['\r\n' + D + '--\r\n', '\r\n' + D + '--', '\r\n' + D + '--\r\n\r\n', '\r\n' + D + '--\r\nepi', '\r\n' + D + '-- \r\n', '\r\n' + D + '\r\n', D + '--', '']));
  if (rand() < 0.25) {
    const arr = Buffer.from(body, 'utf8');
    for (let i = 0; i < 1 + ri(3); i++) { const k = ri(arr.length); const op = ri(3); if (op === 0) arr[k] = pick([13, 10, 45, 32, 9, 34, 59]); else if (op === 1 && arr.length > 40) return { b, np, body: Buffer.concat([arr.subarray(0, k), arr.subarray(k + 1)]) }; }
    return { b, body: arr, np };
  }
  return { b, np, body: Buffer.from(body, 'utf8') };
}
const cts = [(b) => `multipart/form-data; boundary=${b}`, (b) => `multipart/form-data; boundary=${b}`, (b) => `multipart/form-data; boundary="${b}"`, (b) => `multipart/form-data;boundary=${b}`, (b) => `multipart/form-data; boundary=${b}; charset=utf-8`, (b) => `multipart/form-data; charset=utf-8; boundary=${b}`, (b) => `multipart/form-data; boundary=${b}\t`, (b) => `multipart/form-data; boundary=${b};`];
const counts = {}; const fives = []; const known = { boundaryChars: 0, earlyClose: 0, delimiterInValue: 0 };
function classify(b, ct, body, np) {
  const t = body.toString('latin1'); const D = '\r\n--' + b + '--';
  if (/boundary=[^"]*[\/=:(),?]/.test(ct.replace(/boundary=".*?"/, ''))) return 'boundaryChars';
  if (t.indexOf(D) !== t.lastIndexOf(D)) return 'earlyClose';
  if (t.split('--' + b).length - 1 !== np + 1) return 'delimiterInValue';
  return null;
}
function post(path, headers, body) {
  return new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.1', port: 3103, path, method: 'POST', agent, headers: { host: 'localhost:3103', origin: BASE, 'sec-fetch-site': 'same-origin', 'content-length': body.length, ...headers } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); r.on('error', () => resolve('res-err')); });
    rq.on('error', (e) => resolve('ERR:' + e.code)); rq.setTimeout(10000, () => { rq.destroy(); resolve('timeout'); });
    rq.end(body);
  });
}
const t0 = Date.now();
for (let i = 0; i < Number(n); i++) {
  const { b, body, np } = build();
  const ct = pick(cts)(b);
  const id = rand() < 0.5 ? create : rename;
  const path = rand() < 0.5 ? '/projects' : '/projects/00000000-0000-4000-8000-000000000000';
  const headers = { 'content-type': ct }; if (rand() < 0.93) headers['next-action'] = id;
  const st = await post(path, headers, body);
  counts[st] = (counts[st] ?? 0) + 1;
  if (typeof st !== 'number' ? st !== 'ERR:ECONNRESET' : st >= 500) { const k = classify(b, ct, body, np); if (k) { known[k]++; continue; } if (fives.length < 60) fives.push({ st, path, ct, action: !!headers['next-action'], body: body.toString('latin1').slice(0, 600) }); }
}
console.log(JSON.stringify({ known, seedUsed: seedArg ?? 'time', iterations: Number(n), seconds: Math.round((Date.now() - t0) / 1000), counts }));
for (const f of fives) console.log('5xx/ERR sample:', JSON.stringify(f));
