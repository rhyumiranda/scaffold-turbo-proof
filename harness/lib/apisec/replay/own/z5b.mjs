// z5 own attack B: both action ids x every route x method x content-type x origin shape; Next-Action header shapes; urlencoded/progressive shapes;
// cookies; HTTP framing (CL/TE/chunked/Expect/pipelining/upgrade); slow clients.
import { capture, Tally, rq, send, out } from './z5lib.mjs';
const c = await capture();
console.log(JSON.stringify({ createId: c.createId, renameId: c.renameId, pid: c.pid }));
const cookieName = c.cookie.split(';')[0].split('=')[0];
const T = new Tally('z5b-actions-framing');
const O = 'http://localhost:3103';
const good = (n = 'z5-b') => '--BB\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--BB\r\nContent-Disposition: form-data; name="_1_name"\r\n\r\n' + n + '\r\n--BB--\r\n';
const goodRen = (n) => '--BB\r\nContent-Disposition: form-data; name="0"\r\n\r\n["' + c.pid + '",{"status":"idle","message":""},"$K1"]\r\n--BB\r\nContent-Disposition: form-data; name="_1_name"\r\n\r\n' + n + '\r\n--BB\r\nContent-Disposition: form-data; name="_1_expectedVersion"\r\n\r\n1\r\n--BB--\r\n';
const MP = 'multipart/form-data; boundary=BB';
const ids = { create: c.createId, rename: c.renameId, bogus: '0'.repeat(42), empty: '', short: 'a', long: 'a'.repeat(5000), nonhex: 'zz-zz', unicode: 'é', space: 'a b', comma: c.createId + ',' + c.renameId, upper: c.createId.toUpperCase(), prefixed: ' ' + c.createId, dollar: '$ACTION_ID_x', pct: '%00', dot: '..', slash: '/projects' };
const paths = ['/', '/projects', '/projects/' + c.pid, '/projects/' + '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12), '/signed-out', '/sign-in-problem', '/nope', '/auth/login', '/auth/logout', '/auth/callback', '/auth/refresh', '/healthz', '/_not-found', '/PROJECTS', '/projects/', '/Projects/' + c.pid, '/favicon.ico', '/_next/static/x', '/_next/image', '/projects.rsc', '/x/../projects', '/projects?_rsc=1', '/%70rojects', '//projects'];
// 1) matrix: ids x paths with browser-shaped multipart, with origin ok + cookie
for (const [idn, id] of Object.entries(ids)) for (const p of paths) {
  const body = idn === 'rename' || p.includes(c.pid) ? goodRen('z5-m') : good('z5-m');
  await T.run(`M1 id=${idn} ${p.slice(0, 40)} multipart origin-ok cookie`, rq({ method: 'POST', target: p, h: { Origin: O, 'Sec-Fetch-Site': 'same-origin', 'Next-Action': id, 'Content-Type': MP, Cookie: c.cookie }, body }));
}
// 2) content types / methods / origin shapes, real ids, real paths
const cts = [MP, 'application/x-www-form-urlencoded', 'text/plain', 'text/plain;charset=UTF-8', 'application/json', 'application/octet-stream', 'multipart/form-data', 'multipart/mixed; boundary=BB', 'MULTIPART/FORM-DATA; boundary=BB', 'multipart/form-data; boundary=BB; charset=utf-8', 'multipart/form-data;boundary=BB', 'multipart/form-data; boundary="BB"', 'application/x-www-form-urlencoded; charset=utf-8', 'APPLICATION/X-WWW-FORM-URLENCODED', 'text/x-component', 'application/react-server', 'application/vnd.api+json', '*/*', '', 'x', 'a/b/c', 'text/plain, multipart/form-data; boundary=BB', 'multipart/form-data; boundary=BB, text/plain'];
const bodies = { mp: good('z5-ct'), urlenc: '$ACTION_ID_' + c.createId + '=&_1_name=z5-urlenc', urlenc2: '0=%5B%22%24K1%22%5D&_1_name=x', json: '["$K1"]', json2: '{"0":["$K1"]}', empty: '', text: 'hello', arr: '[]' };
const origins = { ok: { Origin: O, 'Sec-Fetch-Site': 'same-origin' }, evil: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, none: {}, sfsonly: { 'Sec-Fetch-Site': 'same-origin' }, null: { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' }, empty: { Origin: '', 'Sec-Fetch-Site': 'same-origin' }, junk: { Origin: 'not a url', 'Sec-Fetch-Site': 'same-origin' }, userinfo: { Origin: 'http://user@localhost:3103', 'Sec-Fetch-Site': 'same-origin' }, trailing: { Origin: O + '/', 'Sec-Fetch-Site': 'same-origin' }, upper: { Origin: 'HTTP://LOCALHOST:3103', 'Sec-Fetch-Site': 'same-origin' }, port80: { Origin: 'http://localhost', 'Sec-Fetch-Site': 'same-origin' }, ip: { Origin: 'http://127.0.0.1:3103', 'Sec-Fetch-Site': 'same-origin' }, https: { Origin: 'https://localhost:3103', 'Sec-Fetch-Site': 'same-origin' }, sfsMulti: { Origin: O, 'Sec-Fetch-Site': 'same-origin, cross-site' }, sfsSite: { Origin: O, 'Sec-Fetch-Site': 'same-site' }, sfsNone: { Origin: O, 'Sec-Fetch-Site': 'none' }, sfsJunk: { Origin: O, 'Sec-Fetch-Site': 'x' }, originDup: { Origin: O, 'Sec-Fetch-Site': 'same-origin' }, originList: { Origin: O + ', https://evil.example', 'Sec-Fetch-Site': 'same-origin' }, longOrigin: { Origin: 'http://' + 'a'.repeat(9000), 'Sec-Fetch-Site': 'same-origin' } };
for (const m of ['POST', 'GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'])
  for (const [bn, b] of Object.entries(bodies)) for (const ct of cts) for (const [on, oh] of Object.entries(origins)) {
    if (m !== 'POST' && (ct !== MP && ct !== 'text/plain' && ct !== 'application/x-www-form-urlencoded')) continue;
    if (m !== 'POST' && (bn !== 'mp' && bn !== 'urlenc' && bn !== 'empty')) continue;
    if (m === 'POST' && ct !== MP && !['mp', 'urlenc', 'json', 'empty'].includes(bn)) continue;
    if (on !== 'ok' && on !== 'none' && on !== 'evil' && !(ct === MP && bn === 'mp')) continue;
    const raw = on === 'originDup' ? 'Origin: https://evil.example\r\n' : '';
    for (const na of [c.createId, null]) {
      await T.run(`M2 ${m} ct=${ct.slice(0, 30)} body=${bn} origin=${on} na=${na ? 'y' : 'n'}`, rq({ method: m, target: '/projects', h: { ...oh, ...(na ? { 'Next-Action': na } : {}), ...(ct ? { 'Content-Type': ct } : {}), Cookie: c.cookie }, body: m === 'GET' && bn === 'empty' ? null : b, raw }));
    }
  }
// 3) Next-Action header shapes (dup headers, casing, whitespace)
const bodyOk = good('z5-na');
for (const [n, hdrRaw] of Object.entries({ dup: `Next-Action: ${c.createId}\r\nNext-Action: ${c.renameId}\r\n`, lower: `next-action: ${c.createId}\r\n`, upper: `NEXT-ACTION: ${c.createId}\r\n`, trailingSpace: `Next-Action: ${c.createId}   \r\n`, tab: `Next-Action:\t${c.createId}\r\n`, empty: `Next-Action:\r\n`, onlyspace: `Next-Action: \r\n`, nul: `Next-Action: ${c.createId}\u0000\r\n`, comma: `Next-Action: ${c.createId}, ${c.renameId}\r\n`, obsfold: `Next-Action: ${c.createId}\r\n  x\r\n`, utf8: `Next-Action: é\r\n`, long: `Next-Action: ${'a'.repeat(12000)}\r\n`, xaction: `X-Next-Action: ${c.createId}\r\n`, underscore: `Next_Action: ${c.createId}\r\n` })) {
  await T.run('NA ' + n, rq({ method: 'POST', target: '/projects', h: { Origin: O, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': MP, Cookie: c.cookie }, body: bodyOk, raw: hdrRaw }));
}
// 4) session cookie shapes (Redis lookup) on private pages, anon
const base = cookieName;
const cookies = { empty: `${base}=`, junk: `${base}=x`, long: `${base}=${'a'.repeat(9000)}`, nul: `${base}=a%00b`, pct: `${base}=%`, pct2: `${base}=%zz`, star: `${base}=*`, glob: `${base}=[a-z]*`, crlf: `${base}=a%0d%0ab`, dots: `${base}=../../x`, quote: `${base}="${c.cookie.split('=')[1]}"`, uuid: `${base}=00000000-0000-0000-0000-000000000000`, dup: `${base}=a; ${base}=b`, dupReal: `${base}=x; ${c.cookie}`, realDup: `${c.cookie}; ${base}=x`, many: Array.from({ length: 300 }, (_, i) => `k${i}=v`).join('; '), name_empty: `=x`, semi: `;;;`, space: `${base} = x`, tilde: `${base}=~`, utf8: `${base}=é`, emoji: `${base}=😀`, upperName: `${base.toUpperCase()}=${c.cookie.split('=')[1]}`, otherName: `__Host-x=1; ${base}2=1`, hostPrefix: `__Host-sid=x; __Secure-sid=y` };
for (const [n, ck] of Object.entries(cookies)) for (const t of ['/projects', '/projects/' + c.pid, '/', '/auth/login', '/auth/callback?code=a&state=b', '/healthz']) for (const m of ['GET', 'POST']) {
  await T.run(`Cookie ${n} ${m} ${t.slice(0, 25)}`, Buffer.from(rq({ method: m, target: t, h: { Cookie: ck, ...(m === 'POST' ? { Origin: O, 'Sec-Fetch-Site': 'same-origin', 'Next-Action': c.createId, 'Content-Type': MP } : {}) }, body: m === 'POST' ? good('z5-ck') : null }).toString('latin1'), 'latin1'));
}
// 5) HTTP framing
const lh = 'Host: localhost:3103\r\n', ah = `Origin: ${O}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: ${c.createId}\r\nContent-Type: ${MP}\r\nCookie: ${c.cookie}\r\n`;
const bd = good('z5-fr'); const L = Buffer.byteLength(bd);
const chunk = (s, n = s.length) => n.toString(16) + '\r\n' + s + '\r\n';
const fr = {
  'cl ok': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: ${L}\r\n\r\n${bd}`,
  'cl+te chunked': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: ${L}\r\nTransfer-Encoding: chunked\r\n\r\n${chunk(bd)}0\r\n\r\n`,
  'te chunked only': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: chunked\r\n\r\n${chunk(bd)}0\r\n\r\n`,
  'te chunked ext': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: chunked\r\n\r\n${L.toString(16)};ext=1\r\n${bd}\r\n0\r\n\r\n`,
  'te chunked trailer': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: chunked\r\n\r\n${chunk(bd)}0\r\nX-T: 1\r\n\r\n`,
  'te chunked bad size': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: chunked\r\n\r\nZZ\r\n${bd}\r\n0\r\n\r\n`,
  'te chunked neg size': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: chunked\r\n\r\n-1\r\n${bd}\r\n0\r\n\r\n`,
  'te chunked huge size': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: chunked\r\n\r\nFFFFFFFFFFFFFFFF\r\n${bd}\r\n0\r\n\r\n`,
  'te chunked no terminator': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: chunked\r\n\r\n${chunk(bd)}`,
  'te gzip chunked': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: gzip, chunked\r\n\r\n${chunk(bd)}0\r\n\r\n`,
  'te identity': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: identity\r\nContent-Length: ${L}\r\n\r\n${bd}`,
  'te x': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: x\r\nContent-Length: ${L}\r\n\r\n${bd}`,
  'te chunked spaced': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding : chunked\r\n\r\n${chunk(bd)}0\r\n\r\n`,
  'te CHUNKED': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: CHUNKED\r\n\r\n${chunk(bd)}0\r\n\r\n`,
  'te dup': `POST /projects HTTP/1.1\r\n${lh}${ah}Transfer-Encoding: chunked\r\nTransfer-Encoding: chunked\r\n\r\n${chunk(bd)}0\r\n\r\n`,
  'cl dup same': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: ${L}\r\nContent-Length: ${L}\r\n\r\n${bd}`,
  'cl dup diff': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: ${L}\r\nContent-Length: ${L + 1}\r\n\r\n${bd}`,
  'cl list': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: ${L}, ${L}\r\n\r\n${bd}`,
  'cl neg': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: -1\r\n\r\n${bd}`,
  'cl plus': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: +${L}\r\n\r\n${bd}`,
  'cl hex': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: 0x${L.toString(16)}\r\n\r\n${bd}`,
  'cl float': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: ${L}.0\r\n\r\n${bd}`,
  'cl space': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length:  ${L} \r\n\r\n${bd}`,
  'cl huge': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: 99999999999999999999999\r\n\r\n${bd}`,
  'cl 2^53': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: 9007199254740993\r\n\r\n${bd}`,
  'cl 1MiB exact (rest short, wait)': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: 1048576\r\n\r\n${bd}`,
  'cl 1MiB+1': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: 1048577\r\n\r\n${bd}`,
  'cl 0 with body': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: 0\r\n\r\n${bd}`,
  'cl short': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: ${L - 10}\r\n\r\n${bd}`,
  'no cl no te': `POST /projects HTTP/1.1\r\n${lh}${ah}\r\n${bd}`,
  'get with body+cl': `GET /projects HTTP/1.1\r\n${lh}Cookie: ${c.cookie}\r\nContent-Length: ${L}\r\n\r\n${bd}`,
  'get chunked body': `GET /projects HTTP/1.1\r\n${lh}Cookie: ${c.cookie}\r\nTransfer-Encoding: chunked\r\n\r\n${chunk(bd)}0\r\n\r\n`,
  'head with body': `HEAD /projects HTTP/1.1\r\n${lh}Cookie: ${c.cookie}\r\nContent-Length: ${L}\r\n\r\n${bd}`,
  'expect 100': `POST /projects HTTP/1.1\r\n${lh}${ah}Expect: 100-continue\r\nContent-Length: ${L}\r\n\r\n${bd}`,
  'expect 100 evil origin': `POST /projects HTTP/1.1\r\n${lh}Origin: https://evil.example\r\nExpect: 100-continue\r\nContent-Type: ${MP}\r\nContent-Length: ${L}\r\n\r\n`,
  'expect junk': `POST /projects HTTP/1.1\r\n${lh}${ah}Expect: foo\r\nContent-Length: ${L}\r\n\r\n${bd}`,
  'expect 100 1MiB+': `POST /projects HTTP/1.1\r\n${lh}${ah}Expect: 100-continue\r\nContent-Length: 5000000\r\n\r\n`,
  'upgrade websocket': `GET / HTTP/1.1\r\n${lh}Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
  'upgrade websocket /_next/webpack-hmr': `GET /_next/webpack-hmr HTTP/1.1\r\n${lh}Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
  'upgrade h2c': `GET / HTTP/1.1\r\n${lh}Connection: Upgrade, HTTP2-Settings\r\nUpgrade: h2c\r\nHTTP2-Settings: AAMAAABkAARAAAAAAAIAAAAA\r\n\r\n`,
  'upgrade junk': `GET / HTTP/1.1\r\n${lh}Connection: Upgrade\r\nUpgrade: foo\r\n\r\n`,
  'upgrade POST': `POST /projects HTTP/1.1\r\n${lh}${ah}Connection: Upgrade\r\nUpgrade: websocket\r\nContent-Length: ${L}\r\n\r\n${bd}`,
  'upgrade no connection hdr': `GET / HTTP/1.1\r\n${lh}Upgrade: websocket\r\n\r\n`,
  'upgrade tls': `GET / HTTP/1.1\r\n${lh}Connection: Upgrade\r\nUpgrade: TLS/1.0\r\n\r\n`,
  'upgrade CONNECT-ish *': `OPTIONS * HTTP/1.1\r\n${lh}Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
  'conn close': `GET / HTTP/1.1\r\n${lh}Connection: close\r\n\r\n`,
  'conn keepalive junk': `GET / HTTP/1.1\r\n${lh}Connection: keep-alive, x, close\r\n\r\n`,
  'conn te': `GET / HTTP/1.1\r\n${lh}Connection: TE\r\nTE: trailers, deflate;q=0.5\r\n\r\n`,
  'pipelined 2 GET': `GET / HTTP/1.1\r\n${lh}\r\nGET /nope HTTP/1.1\r\n${lh}Connection: close\r\n\r\n`,
  'pipelined POST then smuggled GET': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: ${L}\r\n\r\n${bd}GET /projects HTTP/1.1\r\n${lh}Cookie: ${c.cookie}\r\nConnection: close\r\n\r\n`,
  'pipelined smuggled POST after short cl': `POST /projects HTTP/1.1\r\n${lh}${ah}Content-Length: ${L - 3}\r\n\r\n${bd}`,
  'request 8 pipelined': Array.from({ length: 8 }, (_, i) => `GET /${'x'.repeat(i)} HTTP/1.1\r\n${lh}\r\n`).join(''),
  'obs-fold header': `GET / HTTP/1.1\r\n${lh}X-A: b\r\n c\r\n\r\n`,
  'header no colon': `GET / HTTP/1.1\r\n${lh}garbage\r\n\r\n`,
  'header space before colon': `GET / HTTP/1.1\r\n${lh}X-A : b\r\n\r\n`,
  'header empty name': `GET / HTTP/1.1\r\n${lh}: b\r\n\r\n`,
  'header nul value': `GET / HTTP/1.1\r\n${lh}X-A: a\u0000b\r\n\r\n`,
  'header ctl value': `GET / HTTP/1.1\r\n${lh}X-A: a\u0001b\r\n\r\n`,
  'header hi-bit value': `GET / HTTP/1.1\r\n${lh}X-A: ÿþ\r\n\r\n`,
  'header lf-only inside': `GET / HTTP/1.1\r\n${lh}X-A: a\nX-B: b\r\n\r\n`,
  'header cr inside': `GET / HTTP/1.1\r\n${lh}X-A: a\rb\r\n\r\n`,
  'host dup': `GET / HTTP/1.1\r\nHost: localhost:3103\r\nHost: evil.example\r\n\r\n`,
  'host dup post action': `POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nHost: evil.example\r\n${ah}Content-Length: ${L}\r\n\r\n${bd}`,
  'host absolute-form mismatch': `GET http://evil.example/ HTTP/1.1\r\n${lh}\r\n`,
  '100 headers': `GET / HTTP/1.1\r\n${lh}${Array.from({ length: 100 }, (_, i) => `X-H${i}: v`).join('\r\n')}\r\n\r\n`,
  '101 headers': `GET / HTTP/1.1\r\n${lh}${Array.from({ length: 101 }, (_, i) => `X-H${i}: v`).join('\r\n')}\r\n\r\n`,
  '5000 headers': `GET / HTTP/1.1\r\n${lh}${Array.from({ length: 5000 }, (_, i) => `X-H${i}: v`).join('\r\n')}\r\n\r\n`,
  'header 16k': `GET / HTTP/1.1\r\n${lh}X-A: ${'a'.repeat(16000)}\r\n\r\n`,
  'header 17k': `GET / HTTP/1.1\r\n${lh}X-A: ${'a'.repeat(17000)}\r\n\r\n`,
  'cookie 15k': `GET /projects HTTP/1.1\r\n${lh}Cookie: ${base}=${'a'.repeat(15000)}\r\n\r\n`,
  'range multi': `GET /favicon.ico HTTP/1.1\r\n${lh}Range: bytes=${Array.from({ length: 500 }, () => '0-0').join(',')}\r\n\r\n`,
  'accept-encoding junk': `GET / HTTP/1.1\r\n${lh}Accept-Encoding: ${'gzip,'.repeat(2000)}br;q=zz\r\n\r\n`,
  'if-none-match many': `GET / HTTP/1.1\r\n${lh}If-None-Match: ${Array.from({ length: 1000 }, (_, i) => `"${i}"`).join(', ')}\r\n\r\n`,
  'if-modified-since junk': `GET / HTTP/1.1\r\n${lh}If-Modified-Since: x\r\nIf-Unmodified-Since: y\r\n\r\n`,
  'accept junk': `GET / HTTP/1.1\r\n${lh}Accept: ${'a/b;q=1,'.repeat(3000)}\r\n\r\n`,
  'accept-language junk': `GET / HTTP/1.1\r\n${lh}Accept-Language: ${'en,'.repeat(3000)};q=\r\n\r\n`,
  'user-agent huge': `GET / HTTP/1.1\r\n${lh}User-Agent: ${'U'.repeat(12000)}\r\n\r\n`,
  'referer huge': `GET / HTTP/1.1\r\n${lh}Referer: http://${'r'.repeat(12000)}\r\n\r\n`,
  'te trailers get': `GET / HTTP/1.1\r\n${lh}TE: trailers\r\n\r\n`,
  'via/max-forwards': `TRACE / HTTP/1.1\r\n${lh}Max-Forwards: 0\r\n\r\n`,
};
for (const [n, r] of Object.entries(fr)) await T.run('FR ' + n, Buffer.from(r, 'latin1'), { timeout: 12000 });
console.log(JSON.stringify(T.done()));
