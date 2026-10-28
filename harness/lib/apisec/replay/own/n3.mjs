// z5 NEW attacks N3: hosts/forwarded headers, HTTP framing, pipelining, byte-mutation fuzz of whole raw requests, liveness checks.
import { capture, Tally, rq, send } from './z5lib.mjs';
import net from 'node:net';
const c = await capture();
const T = new Tally('n3-hosts-framing-mutation');
const run = (label, buf, o) => T.run(label, buf, o);
const O = 'http://localhost:3103';
const mp = (parts, b = 'BB') => parts.map(([n, v]) => `--${b}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`).join('') + `--${b}--\r\n`;
const goodBody = mp([['_1_name', 'n3-ok'], ['0', '[{"status":"idle","message":""},"$K1"]']]);
const live = async (tag) => { const r = await send(rq({ target: '/healthz' }), { timeout: 5000 }); const ok = r.status === 200; console.log(`LIVENESS ${tag}: ${r.status} ${r.ms}ms`); if (!ok) T.bad.push({ label: 'liveness ' + tag, status: r.status }); return ok; };

// ---- N3a: Host / forwarded shapes on GET and on a valid-looking action write
const hosts = ['localhost:3103', 'LOCALHOST:3103', 'localhost:3103.', 'localhost', 'localhost:', 'localhost:0', 'localhost:99999', 'localhost:-1', 'localhost:3103:3103', '127.0.0.1:3103', '[::1]:3103', '[::1', '::1', '[::ffff:127.0.0.1]:3103', '0x7f.1:3103', '2130706433:3103', 'evil.example', 'evil.example:3103', 'localhost:3103@evil.example', 'evil.example@localhost:3103', 'user:pw@localhost:3103', 'localhost:3103/', 'localhost:3103/x', 'localhost:3103?x', 'localhost:3103#x', 'local host', 'localhost:3103 ', ' localhost:3103', 'localhost:3103\t', 'localhost:3103,evil.example', 'evil.example,localhost:3103', 'xn--', 'xn--a.example', 'exämple.org', 'ÿþ', '\u0001', 'a'.repeat(300), 'a.'.repeat(500), 'a'.repeat(9000) + ':3103', '%', '%zz.example', '..', '.', '-', '*', 'null', '[', ']', '{}', ''];
for (const h of hosts) {
  await run(`Host ${JSON.stringify(h).slice(0, 40)} GET /`, Buffer.from(`GET / HTTP/1.1\r\nHost: ${h}\r\n\r\n`, 'latin1'));
  await run(`Host ${JSON.stringify(h).slice(0, 40)} GET /projects authed`, Buffer.from(`GET /projects HTTP/1.1\r\nHost: ${h}\r\nCookie: ${c.cookie}\r\n\r\n`, 'latin1'));
  await run(`Host ${JSON.stringify(h).slice(0, 40)} GET /nope RSC`, Buffer.from(`GET /nope HTTP/1.1\r\nHost: ${h}\r\nRSC: 1\r\n\r\n`, 'latin1'));
  for (const origin of [O, 'http://' + h, 'https://' + h]) await run(`Host ${JSON.stringify(h).slice(0, 30)} + Origin ${origin.slice(0, 30)} action`, Buffer.concat([Buffer.from(`POST /projects HTTP/1.1\r\nHost: ${h}\r\nOrigin: ${origin}\r\nSec-Fetch-Site: same-origin\r\nContent-Type: multipart/form-data; boundary=BB\r\nNext-Action: ${c.createId}\r\nCookie: ${c.cookie}\r\nContent-Length: ${Buffer.byteLength(goodBody)}\r\n\r\n`, 'latin1'), Buffer.from(goodBody)]));
}
await run('no Host HTTP/1.1', Buffer.from('GET / HTTP/1.1\r\n\r\n'));
await run('no Host HTTP/1.0', Buffer.from('GET / HTTP/1.0\r\n\r\n'));
await run('two Host headers', Buffer.from('GET / HTTP/1.1\r\nHost: localhost:3103\r\nHost: evil.example\r\n\r\n'));
await run('absolute-URI target with other Host', Buffer.from('GET http://evil.example/projects HTTP/1.1\r\nHost: localhost:3103\r\n\r\n'));
for (const [k, vs] of Object.entries({ 'X-Forwarded-Host': ['evil.example', 'localhost:3103', 'localhost:3103, evil.example', 'evil.example, localhost:3103', '', ' ', '%', 'a'.repeat(5000), '[::1]', 'user@evil', 'evil.example/x'], 'X-Forwarded-Proto': ['https', 'http', 'ftp', 'https, http', '', 'x'.repeat(3000)], 'X-Forwarded-Port': ['443', '0', '99999', 'x', ''], 'X-Forwarded-For': ['1.1.1.1', 'x', '1.1.1.1, 2.2.2.2', '::1', ''], 'Forwarded': ['host=evil.example', 'for=1.1.1.1;host=a;proto=https', 'x', '=', ';;;', 'host="evil.example'], 'X-Original-Host': ['evil.example'], 'X-Host': ['evil.example'], 'X-Forwarded-Server': ['evil.example'], 'X-HTTP-Host-Override': ['evil.example'], 'Via': ['1.1 evil'], 'X-Real-IP': ['1.1.1.1'], 'CF-Connecting-IP': ['1.1.1.1'], 'True-Client-IP': ['1.1.1.1'], 'Origin': ['http://localhost:3103', 'null', 'x', '', '%', 'http://localhost:3103/', 'http://localhost:3103?x', 'http://LOCALHOST:3103', 'http://localhost:3103.', 'http://localhost:3103:3103', 'file://', 'chrome-extension://x'], 'Sec-Fetch-Site': ['same-origin', 'same-site', 'cross-site', 'none', 'x', '', 'SAME-ORIGIN'], 'Sec-Fetch-Mode': ['cors', 'navigate', 'x'], 'Sec-Fetch-Dest': ['document', 'x'], 'Referer': ['http://localhost:3103/projects', 'x', '%', 'a'.repeat(9000)] })) {
  for (const v of vs) {
    await run(`${k}: ${v.slice(0, 30)} GET /projects`, rq({ target: '/projects', h: { Cookie: c.cookie, [k]: v } }));
    await run(`${k}: ${v.slice(0, 30)} action`, rq({ method: 'POST', target: '/projects', h: { Origin: O, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'multipart/form-data; boundary=BB', 'Next-Action': c.createId, Cookie: c.cookie, [k]: v }, body: Buffer.from(goodBody) }));
    await run(`${k}: ${v.slice(0, 30)} POST /auth/logout`, rq({ method: 'POST', target: '/auth/logout', h: { Origin: O, 'Sec-Fetch-Site': 'same-origin', 'Content-Length': '0', [k]: v } }));
  }
}
await live('after hosts');

// ---- N3b: framing, methods, pipelining
const M = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT', 'PROPFIND', 'PURGE', 'get', 'Get', 'G E T', 'GET\t', 'LINK', 'MKCOL', 'REPORT', 'SEARCH', 'QUERY', 'X'.repeat(300), 'PRI', 'M-SEARCH', 'NOTIFY', 'SUBSCRIBE'];
for (const m of M) for (const p of ['/', '/projects', '/auth/logout', '/healthz', '/_global-error', '/nope']) {
  await run(`method ${JSON.stringify(m).slice(0, 20)} ${p}`, Buffer.from(`${m} ${p} HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nContent-Length: 0\r\n\r\n`));
  await run(`method ${JSON.stringify(m).slice(0, 20)} ${p} +Next-Action`, Buffer.from(`${m} ${p} HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: ${c.createId}\r\nContent-Length: 0\r\n\r\n`));
}
for (const v of ['HTTP/1.0', 'HTTP/0.9', 'HTTP/2.0', 'HTTP/1.2', 'HTTP/1.1 ', 'http/1.1', 'HTTP/1', 'HTTP/', 'HTTPS/1.1', 'HTTP/11.1', 'HTTP/1.1x']) await run(`version ${v}`, Buffer.from(`GET /projects ${v}\r\nHost: localhost:3103\r\n\r\n`));
await run('HTTP/0.9 style request line', Buffer.from('GET /\r\n'));
await run('bare LF line endings', Buffer.from('GET / HTTP/1.1\nHost: localhost:3103\n\n'));
await run('bare CR line endings', Buffer.from('GET / HTTP/1.1\rHost: localhost:3103\r\r'));
await run('space before header colon', Buffer.from('GET / HTTP/1.1\r\nHost : localhost:3103\r\n\r\n'));
await run('header with no colon', Buffer.from('GET / HTTP/1.1\r\nHost: localhost:3103\r\nBroken\r\n\r\n'));
await run('empty header name', Buffer.from('GET / HTTP/1.1\r\nHost: localhost:3103\r\n: x\r\n\r\n'));
await run('NUL in header value', Buffer.from('GET / HTTP/1.1\r\nHost: localhost:3103\r\nX: a\u0000b\r\n\r\n'));
await run('8-bit header name', Buffer.from('GET / HTTP/1.1\r\nHost: localhost:3103\r\nXé: a\r\n\r\n', 'latin1'));
await run('100 headers', Buffer.from('GET / HTTP/1.1\r\nHost: localhost:3103\r\n' + Array.from({ length: 100 }, (_, i) => `X-${i}: v`).join('\r\n') + '\r\n\r\n'));
await run('2000 headers', Buffer.from('GET / HTTP/1.1\r\nHost: localhost:3103\r\n' + Array.from({ length: 2000 }, (_, i) => `X-${i}: v`).join('\r\n') + '\r\n\r\n'));
await run('one 20KB header', Buffer.from('GET / HTTP/1.1\r\nHost: localhost:3103\r\nX: ' + 'a'.repeat(20000) + '\r\n\r\n'));
await run('cookie 12KB', rq({ target: '/projects', h: { Cookie: 'a=' + 'b'.repeat(12000) } }));
await run('cookie 12KB valid session first', rq({ target: '/projects', h: { Cookie: c.cookie + '; a=' + 'b'.repeat(12000) } }));
await run('200 cookies', rq({ target: '/projects', h: { Cookie: Array.from({ length: 200 }, (_, i) => `c${i}=v`).join('; ') + '; ' + c.cookie } }));
await run('GET with body+CL', rq({ target: '/projects', h: { Cookie: c.cookie }, body: 'abc' }));
await run('HEAD with body', rq({ method: 'HEAD', target: '/projects', h: { Cookie: c.cookie }, body: 'abc' }));
await run('GET with chunked body', Buffer.from('GET /projects HTTP/1.1\r\nHost: localhost:3103\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n'));
await run('GET with Next-Action', rq({ target: '/projects', h: { 'Next-Action': c.createId, Cookie: c.cookie } }));
await run('OPTIONS with ACR headers', rq({ method: 'OPTIONS', target: '/projects', h: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'next-action' } }));
await run('POST chunked action (good)', Buffer.from(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nContent-Type: multipart/form-data; boundary=BB\r\nNext-Action: ${c.createId}\r\nCookie: ${c.cookie}\r\nTransfer-Encoding: chunked\r\n\r\n${Buffer.byteLength(goodBody).toString(16)}\r\n${goodBody}\r\n0\r\n\r\n`));
await run('POST chunked + CL (smuggling shape)', Buffer.from(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nContent-Type: multipart/form-data; boundary=BB\r\nNext-Action: ${c.createId}\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n${Buffer.byteLength(goodBody).toString(16)}\r\n${goodBody}\r\n0\r\n\r\n`));
await run('POST TE: identity', Buffer.from(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: ${c.createId}\r\nTransfer-Encoding: identity\r\nContent-Length: 0\r\n\r\n`));
await run('POST chunked bad size', Buffer.from(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: ${c.createId}\r\nTransfer-Encoding: chunked\r\n\r\nZZ\r\nabc\r\n0\r\n\r\n`));
await run('POST chunked huge size', Buffer.from(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: ${c.createId}\r\nTransfer-Encoding: chunked\r\n\r\nFFFFFFFFFFFFFFFF\r\nabc\r\n0\r\n\r\n`));
await run('POST CL two values', Buffer.from(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: ${c.createId}\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\nabcde`));
await run('POST CL 5, 20 bytes sent (second request smuggled)', Buffer.from(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: ${c.createId}\r\nContent-Length: 5\r\n\r\nabcdeGET /_global-error HTTP/1.1\r\nHost: localhost:3103\r\n\r\n`));
await run('Expect: 100-continue good', Buffer.concat([Buffer.from(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nExpect: 100-continue\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nContent-Type: multipart/form-data; boundary=BB\r\nNext-Action: ${c.createId}\r\nCookie: ${c.cookie}\r\nContent-Length: ${Buffer.byteLength(goodBody)}\r\n\r\n`), Buffer.from(goodBody)]));
await run('Expect: nonsense', Buffer.from(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nExpect: nonsense\r\nContent-Length: 0\r\n\r\n`));
await run('Upgrade websocket', Buffer.from('GET /projects HTTP/1.1\r\nHost: localhost:3103\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'));
await run('Upgrade websocket to /_next/webpack-hmr', Buffer.from('GET /_next/webpack-hmr HTTP/1.1\r\nHost: localhost:3103\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n'));
await run('Upgrade h2c', Buffer.from('GET /projects HTTP/1.1\r\nHost: localhost:3103\r\nConnection: Upgrade, HTTP2-Settings\r\nUpgrade: h2c\r\nHTTP2-Settings: AAMAAABkAAQAAP__\r\n\r\n'));
await run('HTTP/2 preface', Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n'));
await run('TLS ClientHello garbage', Buffer.from([0x16, 0x03, 0x01, 0x00, 0x05, 0x01, 0x00, 0x00, 0x01, 0x03]));
await run('pipelined 3 requests (2nd bad path)', Buffer.from('GET /healthz HTTP/1.1\r\nHost: localhost:3103\r\n\r\nGET /% HTTP/1.1\r\nHost: localhost:3103\r\n\r\nGET /healthz HTTP/1.1\r\nHost: localhost:3103\r\n\r\n'), { collect: true, settle: 800 });
await run('pipelined 3 requests (2nd _global-error)', Buffer.from('GET /healthz HTTP/1.1\r\nHost: localhost:3103\r\n\r\nGET /_global-error HTTP/1.1\r\nHost: localhost:3103\r\n\r\nGET /healthz HTTP/1.1\r\nHost: localhost:3103\r\n\r\n'), { collect: true, settle: 800 });
await run('pipelined bad tree then ok', Buffer.from('GET /nope HTTP/1.1\r\nHost: localhost:3103\r\nRSC: 1\r\nNext-Router-State-Tree: %\r\n\r\nGET /healthz HTTP/1.1\r\nHost: localhost:3103\r\n\r\n'), { collect: true, settle: 800 });
await live('after framing');

// ---- N3c: stalled / aborted clients (the server must answer or cut them off by itself)
const slow = (label, parts, gap, wait) => new Promise((resolve) => {
  const s = net.connect(3103, '127.0.0.1'); const t0 = Date.now(); let got = ''; let i = 0; let closed = false;
  s.on('data', (d) => { got += d.toString('latin1'); }); s.on('error', () => {}); s.on('close', () => { closed = true; });
  const tick = () => { if (i < parts.length && !closed) { s.write(parts[i++]); setTimeout(tick, gap); } };
  s.on('connect', tick);
  setTimeout(() => { const m = /^HTTP\/1\.1 (\d{3})/.exec(got); const row = { label, ms: Date.now() - t0, status: m ? Number(m[1]) : closed ? 'closed-silent' : 'open-silent' }; s.destroy(); T.rows.push(row); T.statuses[row.status] = (T.statuses[row.status] || 0) + 1; if (typeof row.status === 'number' && row.status >= 500) T.bad.push(row); console.log('SLOW', JSON.stringify(row)); resolve(row); }, wait);
});
await slow('headers trickled then stall', ['GET / HTTP/1.1\r\n', 'Host: localhost:3103\r\n'], 500, 12500);
await slow('partial request line stall', ['GET /pro'], 100, 12500);
await slow('body shorter than CL (action)', [`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: ${c.createId}\r\nContent-Type: multipart/form-data; boundary=BB\r\nCookie: ${c.cookie}\r\nContent-Length: ${Buffer.byteLength(goodBody) + 50}\r\n\r\n`, goodBody], 500, 33000);
await slow('body trickled 1 byte/s (action)', [`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: ${c.createId}\r\nContent-Type: multipart/form-data; boundary=BB\r\nCookie: ${c.cookie}\r\nContent-Length: 400\r\n\r\n`, ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')], 1000, 33000);
await slow('connect and idle', [], 100, 6000);
// abort mid-body repeatedly, then verify the server is healthy
for (let i = 0; i < 40; i++) {
  await new Promise((resolve) => { const s = net.connect(3103, '127.0.0.1'); s.on('error', () => {}); s.on('connect', () => { s.write(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: ${c.createId}\r\nContent-Type: multipart/form-data; boundary=BB\r\nCookie: ${c.cookie}\r\nContent-Length: 5000\r\n\r\n${goodBody.slice(0, 40 + i)}`); setTimeout(() => { i % 2 ? s.destroy() : s.resetAndDestroy(); resolve(); }, 30); }); });
}
await live('after aborts');

// ---- N3d: byte-mutation fuzz of whole raw requests (seeded). 5xx and unanswered requests are flagged.
let seed = Number(process.env.SEED ?? 5);
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const ri = (n) => Math.floor(rnd() * n);
const seeds = [
  rq({ method: 'POST', target: '/projects', h: { Origin: O, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'multipart/form-data; boundary=BB', 'Next-Action': c.createId, Cookie: c.cookie }, body: goodBody }),
  rq({ method: 'POST', target: '/projects/' + c.pid, h: { Origin: O, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'multipart/form-data; boundary=BB', 'Next-Action': c.renameId, Cookie: c.cookie }, body: mp([['_1_name', 'n3-r'], ['_1_expectedVersion', '1'], ['0', JSON.stringify([c.pid, { status: 'idle', message: '' }, '$K1'])]]) }),
  rq({ target: '/projects', h: { Cookie: c.cookie, RSC: '1', 'Next-Router-State-Tree': encodeURIComponent('["",{"children":["projects",{"children":["__PAGE__",{}]}]},null,null,true]'), 'Next-Router-Prefetch': '1' } }),
  rq({ target: '/projects/' + c.pid + '?_rsc=abc12', h: { Cookie: c.cookie, RSC: '1' } }),
  rq({ target: '/auth/login?returnTo=%2Fprojects' }), rq({ target: '/auth/callback?code=a&state=b&iss=c' }), rq({ target: '/_next/image?url=%2F&w=64&q=75' }),
  rq({ method: 'POST', target: '/auth/logout', h: { Origin: O, 'Sec-Fetch-Site': 'same-origin', 'Content-Length': '0' } }),
  rq({ method: 'OPTIONS', target: '/projects', h: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } }),
  rq({ target: '/nope', h: { Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'gzip, br', 'Accept-Language': 'en' } }),
];
const dict = ['%', '%zz', '/../', '\r\n', '\r\n\r\n', ': ', 'Next-Action', 'Next-Router-State-Tree', 'RSC: 1', 'Content-Length: ', '--BB', 'BB', '$K1', '$undefined', '["', '"]', '\u0000', '﻿', '%00', '_global-error', '[', '{', 'boundary=', 'multipart/form-data', 'chunked', 'Transfer-Encoding', 'Host: ', 'Origin: ', 'Sec-Fetch-Site: ', 'Cookie: ', '..', '//', '?', '#', ';', '\\', ' ', '\t', 'x'.repeat(300), '9'.repeat(30)];
const mutate = (b) => {
  let a = Buffer.from(b); const k = 1 + ri(4);
  for (let i = 0; i < k; i++) {
    const op = ri(8); const pos = ri(a.length + 1);
    if (op === 0 && a.length) a[pos % a.length] = ri(256);
    else if (op === 1 && a.length) a = Buffer.concat([a.subarray(0, pos), a.subarray(pos + 1 + ri(8))]);
    else if (op === 2) a = Buffer.concat([a.subarray(0, pos), Buffer.from([ri(256)]), a.subarray(pos)]);
    else if (op === 3) a = Buffer.concat([a.subarray(0, pos), Buffer.from(dict[ri(dict.length)], 'latin1'), a.subarray(pos)]);
    else if (op === 4 && a.length) { const s = ri(a.length), l = ri(40); a = Buffer.concat([a.subarray(0, pos), a.subarray(s, s + l), a.subarray(pos)]); }
    else if (op === 5 && a.length) a = a.subarray(0, Math.max(1, pos));
    else if (op === 6 && a.length) { const s = a.toString('latin1'); const m = /Content-Length: (\d+)/.exec(s); if (m) a = Buffer.from(s.replace(m[0], 'Content-Length: ' + [0, 1, +m[1] - 1, +m[1] + 1, 4294967296, 99999999][ri(6)]), 'latin1'); }
    else if (op === 7 && a.length) { const s = a.toString('latin1'); const i2 = s.indexOf('\r\n\r\n'); if (i2 > 0) a = Buffer.from(s.slice(0, i2 + 2) + dict[ri(dict.length)] + s.slice(i2 + 2), 'latin1'); }
  }
  return a;
};
const N = Number(process.env.N ?? 12000); let unanswered = 0;
for (let i = 0; i < N; i++) {
  const m = mutate(seeds[ri(seeds.length)]);
  const r = await send(m, { timeout: 1500, settle: 60 });
  T.statuses[r.status] = (T.statuses[r.status] || 0) + 1; T.rows.push({ label: 'mut' + i, status: r.status });
  if (typeof r.status === 'number' && r.status >= 500) { T.bad.push({ label: 'mut' + i, status: r.status, hex: m.toString('hex').slice(0, 3000), head: r.head }); console.log('5XX mutation', i, r.status, r.head.slice(0, 120)); }
  else if (r.status === 'timeout') unanswered++;
  if (i % 3000 === 2999) await live('mutation ' + (i + 1));
}
console.log('mutation timeouts (server legitimately waiting for the rest of a truncated body):', unanswered);
await live('end');
T.done();
