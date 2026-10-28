// Offline differential fuzz: the proxy's browserMultipart (copied verbatim from apps/web/src/proxy.ts) vs the framework's busboy
// (next/dist/compiled/busboy, same options Next uses). Any body the proxy accepts must give busboy the SAME ordered field list and a clean finish.
import { createRequire } from 'node:module';
import { capture, send } from './z5lib.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
const CLONE = process.env.CLONE;
const req = createRequire(CLONE + '/apps/web/package.json');
const Busboy = req('next/dist/compiled/busboy');
// ---- verbatim copy of the proxy functions (types removed) ----
const src = readFileSync(CLONE + '/apps/web/src/proxy.ts', 'utf8');
const grab = (startRe, endRe) => { const s = src.search(startRe); const rest = src.slice(s); const e = rest.search(endRe); return rest.slice(0, e); };
let code = grab(/const FIELD_NAME/, /\/\/ Strings starting with "\$"/);
code = code.replace(/function browserMultipart\(type: string, body: Uint8Array\)/, 'function browserMultipart(type, body)').replace(/new Map<string, string>\(\)/, 'new Map()');
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

const c = await capture();
console.log(JSON.stringify({ createId: c.createId, renameId: c.renameId }));
const N = Number(process.argv[2] ?? 20000), CONC = 6;
const counts = {}; const bad = []; let sent = 0, accepted = 0;
const ctMut = (t) => { const r = rnd(); if (r < 0.85) return t; return pick([t.replace('multipart/form-data', 'Multipart/Form-Data'), t.replace('; ', ';'), t + '; charset=utf-8', t.replace('boundary=', 'boundary="') + '"', 'multipart/mixed; boundary=' + t.split('=')[1], t.replace('boundary', 'Boundary'), 'multipart/form-data', t + ' ', t.replace(' boundary', '  boundary')]); };
async function one() {
  let { type, body } = build();
  if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) body = body.subarray(3);
  const t2 = ctMut(type);
  const idc = pick(['c', 'c', 'c', 'r', 'r', 'b', 'n']);
  const id = idc === 'c' ? c.createId : idc === 'r' ? c.renameId : idc === 'b' ? '0'.repeat(42) : null;
  const path = pick(['/projects', '/projects/' + c.pid, '/projects/' + c.pid, '/', '/nope']);
  const h = { Origin: 'http://localhost:3103', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': t2, Cookie: rnd() < 0.8 ? c.cookie : undefined };
  if (id) h['Next-Action'] = id;
  if (rnd() < 0.05) h['Content-Type'] = pick(['text/plain', 'application/x-www-form-urlencoded', 'application/json']);
  let head = `POST ${path} HTTP/1.1\r\nHost: localhost:3103\r\n`;
  for (const [k, v] of Object.entries(h)) if (v !== undefined) head += `${k}: ${v}\r\n`;
  head += `Content-Length: ${body.length}\r\n\r\n`;
  const raw = Buffer.concat([Buffer.from(head, 'latin1'), body]);
  const r = await send(raw, { timeout: 10000 });
  sent++;
  const key = String(r.status); counts[key] = (counts[key] || 0) + 1;
  if (typeof r.status !== 'number' ? r.status === 'timeout' : r.status >= 500) bad.push({ status: r.status, type: t2, id: idc, path, body: body.toString('latin1').slice(0, 500), head: r.head.slice(0, 200) });
}
let next = 0; await Promise.all(Array.from({ length: CONC }, async () => { while (next++ < N) await one(); }));
console.log(JSON.stringify({ sent, counts, bad: bad.length }));
for (const b of bad.slice(0, 10)) console.log('BAD', JSON.stringify(b));
if (process.env.OUT) writeFileSync(process.env.OUT + `/z5c-fuzz-${process.argv[3] ?? 1}.json`, JSON.stringify({ sent, counts, bad: bad.slice(0, 50) }));
