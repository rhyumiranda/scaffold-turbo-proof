// Offline differential fuzz: the proxy's browserMultipart (copied verbatim from apps/web/src/proxy.ts) vs the framework's busboy
// (next/dist/compiled/busboy, same options Next uses). Any body the proxy accepts must give busboy the SAME ordered field list and a clean finish.
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
const CLONE = process.env.CLONE;
const req = createRequire(CLONE + '/apps/web/package.json');
const Busboy = req('next/dist/compiled/busboy');
// ---- verbatim copy of the proxy functions (types removed) ----
const src = readFileSync(CLONE + '/apps/web/src/proxy.ts', 'utf8');
const grab = (startRe, endRe) => { const s = src.search(startRe); const rest = src.slice(s); const e = rest.search(endRe); return rest.slice(0, e); };
let code = grab(/const FIELD_NAME/, /\/\/ Strings starting with "\$"/);
code = code.replace('return text.split(delimiter).length - 1 === fields.size + 1 ? fields : undefined;','return fields;').replace(/function browserMultipart\(type: string, body: Uint8Array\)/, 'function browserMultipart(type, body)').replace(/new Map<string, string>\(\)/, 'new Map()');
const browserMultipart = new Function(code + '\nreturn browserMultipart;')();
function busboyParse(type, body) {
  return new Promise((resolve) => {
    const out = { fields: [], files: [], error: null, finished: false };
    let bb;
    try { bb = Busboy({ defParamCharset: 'utf8', headers: { 'content-type': type }, limits: { fieldSize: 1024 * 1024 } }); } catch (e) { out.error = 'ctor:' + e.message; return resolve(out); }
    bb.on('field', (n, v) => out.fields.push([n, v]));
    bb.on('file', (n, s, info) => { out.files.push([n, info.filename]); s.resume(); });
    bb.on('error', (e) => { out.error = e.message; });
    bb.on('finish', () => { out.finished = true; });
    bb.on('close', () => resolve(out));
    bb.end(Buffer.from(body));
  });
}
let seed = Number(process.argv[3] ?? 1) >>> 0 || 1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ri = (n) => Math.floor(rnd() * n);
const bchars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-'.split('');
const boundaries = ['-', '--', '---', '0', 'a', 'B', 'AB', 'a-b', '-a', 'a-', '--a', 'a--', 'a-----', '----', '1', '00', 'xBOUNDx', '----WebKitFormBoundaryAbC123', 'a'.repeat(70), '-'.repeat(70), 'ab', 'abab', 'aaaa', 'aaaaaaaaaa', 'Content-Disposition', 'name', 'form-data', 'Content', 'D'];
const names = ['0', '_1_name', '_1_expectedVersion', '_2_x', '_1_a', '_10_b', '_9999_z'];
const tokens = ['\r\n', '\r', '\n', '--', '-', ' ', '\t', '"', ';', ':', '=', 'Content-Disposition: form-data; name="0"', 'name="0"', '\r\n\r\n', '--B', '--B--', '\r\n--B', '\r\n--B\r\n', '\r\n--B--', '$K1', '["$K1"]', 'x', '\u0000', 'é', '😀', ' ', '﻿', ''];
function rbound() { return rnd() < 0.5 ? pick(boundaries) : Array.from({ length: 1 + ri(6) }, () => pick(bchars)).join(''); }
function rvalue(B) {
  const n = ri(6); let s = '';
  for (let i = 0; i < n; i++) { const t = pick(tokens); s += rnd() < 0.5 ? t.replaceAll('B', B) : t; if (rnd() < 0.2) s += B; if (rnd() < 0.1) s += '--' + B.slice(0, ri(B.length + 1)); }
  return s;
}
function build() {
  const B = rbound(); const D = '--' + B;
  const nparts = 1 + ri(4); let body = '';
  const sep = () => (rnd() < 0.97 ? '\r\n' : pick(['\n', '\r\n\r\n', '\r', ' \r\n']));
  for (let i = 0; i < nparts; i++) {
    const nm = i === 0 && rnd() < 0.6 ? '0' : pick(names);
    const val = rnd() < 0.5 ? '["$K1"]' : rvalue(B);
    body += D + '\r\n' + 'Content-Disposition: form-data; name="' + nm + '"' + (rnd() < 0.03 ? pick(['', ';', ' ', '; filename="a"', '; foo=bar']) : '') + '\r\n\r\n' + val + sep();
  }
  body += D + '--' + (rnd() < 0.9 ? '\r\n' : pick(['', '\r\n\r\n', 'x', ' ', '\r', '\n', '--', '\r\n' + D, '\r\n' + D + '\r\n']));
  // random byte-level mutation
  if (rnd() < 0.3) { const b = Buffer.from(body); for (let k = 0, m = 1 + ri(4); k < m; k++) { const op = ri(4), at = ri(b.length || 1); if (op === 0) b[at] = ri(256); else if (op === 1) { const x = Buffer.from(pick(tokens).replaceAll('B', B)); return { type: 'multipart/form-data; boundary=' + B, body: Buffer.concat([b.subarray(0, at), x, b.subarray(at)]) }; } else if (op === 2) return { type: 'multipart/form-data; boundary=' + B, body: Buffer.concat([b.subarray(0, at), b.subarray(at + 1 + ri(3))]) }; else b[at] = pick([0x0d, 0x0a, 0x2d, 0x22]); } return { type: 'multipart/form-data; boundary=' + B, body: b }; }
  return { type: 'multipart/form-data; boundary=' + B, body: Buffer.from(body) };
}
const N = Number(process.argv[2] ?? 100000);
let accepted = 0, mismatches = [], errs = 0;
for (let i = 0; i < N; i++) {
  const { type, body } = build();
  let fields; try { fields = browserMultipart(type, body); } catch (e) { fields = undefined; }
  if (!fields) continue;
  accepted++;
  const bb = await busboyParse(type, body);
  const want = JSON.stringify([...fields.entries()]);
  const got = JSON.stringify(bb.fields);
  if (bb.error || !bb.finished || bb.files.length || want !== got) { mismatches.push({ type, body: body.toString('latin1').slice(0, 400), proxy: want.slice(0, 300), busboy: got.slice(0, 300), error: bb.error, finished: bb.finished, files: bb.files }); }
}
console.log(JSON.stringify({ generated: N, seed: process.argv[3] ?? 1, accepted, mismatches: mismatches.length }));
for (const m of mismatches.slice(0, 10)) console.log('MISMATCH', JSON.stringify(m));
if (process.env.OUT) writeFileSync(process.env.OUT + `/diff-${process.argv[3] ?? 1}.json`, JSON.stringify({ generated: N, accepted, mismatches: mismatches.slice(0, 50) }));
