// z5 own adversarial shapes, part 2: methods, request-line/header tricks, paths, auth routes, framing. Raw TCP, production web :3103.
import { chromium, kcLogin } from './lib.mjs';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
const env = process.env, BASE = 'http://localhost:3103', out = env.OUT;
const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage();
await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
const caps = {};
page.on('request', (rq) => { const id = rq.headers()['next-action']; if (rq.method() === 'POST' && id && !caps[id]) caps[id] = new URL(rq.url()).pathname.includes('/projects/') ? 'rename' : 'create'; });
await page.getByLabel('Project name').fill('ac41k-seed'); await page.getByRole('button', { name: 'Create project' }).click();
await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
await page.getByRole('link', { name: 'Open created project' }).click(); await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
const pid = page.url().split('/').pop();
await page.getByLabel('Project name').fill('ac41k-renamed'); await page.getByRole('button', { name: 'Save name' }).click();
await page.getByRole('status').filter({ hasText: 'Project renamed.' }).waitFor();
const cookie = (await ctx.cookies(BASE)).map((c) => c.name + '=' + c.value).join('; ');
await browser.close();
const createId = Object.keys(caps).find((k) => caps[k] === 'create'), renameId = Object.keys(caps).find((k) => caps[k] === 'rename');
const rows = []; let bad = 0, total = 0;
function send(raw, timeout = 6000) {
  return new Promise((resolve) => {
    const s = net.connect(3103, '127.0.0.1'); let buf = Buffer.alloc(0); let done = false;
    const fin = (st) => { if (done) return; done = true; s.destroy(); const text = buf.toString('latin1'); const m = /^HTTP\/1\.[01] (\d{3})/.exec(text); resolve({ status: m ? Number(m[1]) : st, head: text.slice(0, 200).replace(/\r\n/g, ' | ') }); };
    s.on('connect', () => s.write(raw)); s.on('data', (d) => { buf = Buffer.concat([buf, d]); if (/^HTTP\/1\.[01] \d{3}/.test(buf.toString('latin1', 0, 16)) && buf.includes('\r\n\r\n')) setTimeout(() => fin('ok'), 120); });
    s.on('error', (e) => fin('socket-error ' + e.code)); s.on('close', () => fin(buf.length ? 'closed-after-data' : 'closed-no-response')); s.setTimeout(timeout, () => fin('timeout'));
  });
}
const R = async (label, rawStr) => {
  total++;
  const res = await send(Buffer.isBuffer(rawStr) ? rawStr : Buffer.from(rawStr, 'latin1'));
  const is5 = typeof res.status === 'number' && res.status >= 500;
  if (is5) bad++;
  const row = { label, status: res.status, flag: is5 ? '5XX' : typeof res.status !== 'number' ? 'NO-RESPONSE:' + res.status : undefined, head: res.head.slice(0, 120) };
  rows.push(row); if (is5) console.log(JSON.stringify(row)); return res;
};
const H = (extra = '', host = 'localhost:3103') => `Host: ${host}\r\n${extra}`;
const call = (method, path, extra = '', body = '', { ver = '1.1', host } = {}) => `${method} ${path} HTTP/${ver}\r\n${H(extra, host)}${body !== '' || method === 'POST' ? `Content-Length: ${Buffer.byteLength(body)}\r\n` : ''}\r\n${body}`;
const OR = `Origin: ${BASE}\r\nSec-Fetch-Site: same-origin\r\n`;
const CK = `Cookie: ${cookie}\r\n`;
// ---- methods x paths
const methods = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE', 'CONNECT', 'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'SEARCH', 'REPORT', 'PURGE', 'LINK', 'UNLINK', 'QUERY', 'SOURCE', 'ACL', 'BIND', 'REBIND', 'UNBIND', 'CHECKOUT', 'MERGE', 'M-SEARCH', 'NOTIFY', 'SUBSCRIBE', 'UNSUBSCRIBE', 'MKACTIVITY', 'MKCALENDAR', 'PRI', 'get', 'Post', 'FOO', 'X'.repeat(200), 'GET ', '*'];
const paths = ['/', '/projects', '/projects/' + pid, '/nope', '/auth/login', '/auth/logout', '/auth/refresh', '/auth/callback', '/auth/other', '/healthz', '/_next/static/x.js', '/favicon.ico', '/signed-out', '/sign-in-problem', '/*', '*'];
for (const m of methods) for (const p of paths) {
  await R(`method ${m.slice(0, 12)} ${p.slice(0, 30)} +body+origin`, call(m, p, OR + `Content-Type: text/plain\r\n`, 'hello'));
  await R(`method ${m.slice(0, 12)} ${p.slice(0, 30)} nobody cookie`, call(m, p, CK));
  if (['PUT', 'DELETE', 'PATCH', 'TRACE'].includes(m)) await R(`method ${m} ${p} next-action`, call(m, p, OR + `Next-Action: ${createId}\r\nContent-Type: multipart/form-data; boundary=B\r\n`, '--B--\r\n'));
}
// ---- request framing
const body = `--B\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--B--\r\n`;
const mpH = `Content-Type: multipart/form-data; boundary=B\r\nNext-Action: ${createId}\r\n`;
const framing = {
  clZero: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: 0\r\n\r\n`,
  clNeg: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: -1\r\n\r\n${body}`,
  clPlus: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: +${body.length}\r\n\r\n${body}`,
  clHex: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: 0x10\r\n\r\n${body}`,
  clSpace: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length:  ${body.length} \r\n\r\n${body}`,
  clTwice: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
  clTwiceDiff: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\nContent-Length: 5\r\n\r\n${body}`,
  clBig: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: 99999999999999999999\r\n\r\n${body}`,
  clShort: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: 10\r\n\r\n${body}`,
  clExactLimitPlus1: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: 1048577\r\n\r\n${body}`,
  clExactLimit: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: 1048576\r\n\r\n${body}`,
  teChunked: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Transfer-Encoding: chunked\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`,
  teChunkedCL: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Transfer-Encoding: chunked\r\nContent-Length: ${body.length}\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`,
  teGzipChunked: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Transfer-Encoding: gzip, chunked\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`,
  teIdentity: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Transfer-Encoding: identity\r\n\r\n${body}`,
  teChunkedBadSize: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Transfer-Encoding: chunked\r\n\r\nZZ\r\n${body}\r\n0\r\n\r\n`,
  teChunkedExt: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Transfer-Encoding: chunked\r\n\r\n${body.length.toString(16)};ext=1\r\n${body}\r\n0\r\n\r\n`,
  teChunkedTrailer: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Transfer-Encoding: chunked\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n0\r\nX-T: 1\r\n\r\n`,
  teCaseless: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}transfer-encoding: CHUNKED\r\n\r\n${body.length.toString(16)}\r\n${body}\r\n0\r\n\r\n`,
  expect100: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'Expect: 100-continue\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  expectBogus: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'Expect: bogus\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  http10: `POST /projects HTTP/1.0\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}`,
  http09: `GET /projects\r\n\r\n`,
  http20: `POST /projects HTTP/2.0\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}`,
  http11x: `POST /projects HTTP/1.9\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}`,
  noHost: `POST /projects HTTP/1.1\r\n${OR}${mpH}Content-Length: ${body.length}\r\n\r\n${body}`,
  hostEmpty: `POST /projects HTTP/1.1\r\nHost:\r\n${OR}${mpH}Content-Length: ${body.length}\r\n\r\n${body}`,
  hostTwice: `POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nHost: evil.example\r\n${OR}${mpH}Content-Length: ${body.length}\r\n\r\n${body}`,
  hostEvil: `POST /projects HTTP/1.1\r\nHost: evil.example\r\n${OR}${mpH}Content-Length: ${body.length}\r\n\r\n${body}`,
  hostIPv6: `POST /projects HTTP/1.1\r\nHost: [::1]:3103\r\n${OR}${mpH}Content-Length: ${body.length}\r\n\r\n${body}`,
  hostHuge: `POST /projects HTTP/1.1\r\nHost: ${'a'.repeat(9000)}\r\n${OR}${mpH}Content-Length: ${body.length}\r\n\r\n${body}`,
  absoluteForm: `POST http://evil.example/projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}`,
  absoluteFormGet: `GET http://evil.example/projects HTTP/1.1\r\n${H()}\r\n`,
  absoluteFormGetNoPath: `GET http://localhost:3103 HTTP/1.1\r\n${H()}\r\n`,
  optionsStar: `OPTIONS * HTTP/1.1\r\n${H()}\r\n`,
  upgradeWs: `GET /projects HTTP/1.1\r\n${H('Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n')}\r\n`,
  upgradeWsNext: `GET /_next/webpack-hmr HTTP/1.1\r\n${H('Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n')}\r\n`,
  upgradeH2c: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'Connection: Upgrade, HTTP2-Settings\r\nUpgrade: h2c\r\nHTTP2-Settings: AAMAAABkAAQAAP__\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  lfOnly: `POST /projects HTTP/1.1\nHost: localhost:3103\n${OR.replace(/\r\n/g, '\n')}${mpH.replace(/\r\n/g, '\n')}Content-Length: ${body.length}\n\n${body}`,
  headerNul: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'X-A: a\u0000b\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  headerObsFold: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'X-A: a\r\n b\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  headerNoColon: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'garbage\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  headerSpaceBeforeColon: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'X-A : a\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  headerHuge: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'X-A: ' + 'a'.repeat(20000) + '\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  headersMany: `POST /projects HTTP/1.1\r\n${H(OR + mpH + Array.from({ length: 3000 }, (_, i) => `X-${i}: 1\r\n`).join(''))}Content-Length: ${body.length}\r\n\r\n${body}`,
  urlHuge: `POST /projects?${'a'.repeat(20000)} HTTP/1.1\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}`,
  urlNul: `POST /projects%00 HTTP/1.1\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}`,
  urlSpace: `POST /pro jects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}`,
  pipelined2: `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}` + `POST /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}`,
  bodyWithGET: `GET /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}`,
  bodyWithGETaction: `GET /projects HTTP/1.1\r\n${H(OR + mpH + CK)}Content-Length: ${body.length}\r\n\r\n${body}`,
  bodyWithHEAD: `HEAD /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}`,
  bodyWithOPTIONS: `OPTIONS /projects HTTP/1.1\r\n${H(OR + mpH)}Content-Length: ${body.length}\r\n\r\n${body}`,
  contentEncodingGzip: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'Content-Encoding: gzip\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  contentEncodingBr: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'Content-Encoding: br\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  contentTypeTwice: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'Content-Type: text/plain\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  nextActionTwice: `POST /projects HTTP/1.1\r\n${H(OR + mpH + `Next-Action: ${renameId}\r\n`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  nextActionEmpty: `POST /projects HTTP/1.1\r\n${H(OR + 'Next-Action:\r\nContent-Type: multipart/form-data; boundary=B\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  nextActionLong: `POST /projects HTTP/1.1\r\n${H(OR + `Next-Action: ${'a'.repeat(8000)}\r\nContent-Type: multipart/form-data; boundary=B\r\n`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  nextActionNonHex: `POST /projects HTTP/1.1\r\n${H(OR + `Next-Action: ../../x%00\r\nContent-Type: multipart/form-data; boundary=B\r\n`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  nextActionCase: `POST /projects HTTP/1.1\r\n${H(OR + `NEXT-ACTION: ${createId.toUpperCase()}\r\nContent-Type: multipart/form-data; boundary=B\r\n`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  originNull: `POST /projects HTTP/1.1\r\n${H(`Origin: null\r\n${mpH}`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  originGarbage: `POST /projects HTTP/1.1\r\n${H(`Origin: ::::\r\n${mpH}`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  originHuge: `POST /projects HTTP/1.1\r\n${H(`Origin: http://${'a'.repeat(9000)}\r\n${mpH}`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  originTwice: `POST /projects HTTP/1.1\r\n${H(`${OR}Origin: https://evil.example\r\n${mpH}`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  originTrailingSlash: `POST /projects HTTP/1.1\r\n${H(`Origin: ${BASE}/\r\nSec-Fetch-Site: same-origin\r\n${mpH}`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  sfsGarbage: `POST /projects HTTP/1.1\r\n${H(`Origin: ${BASE}\r\nSec-Fetch-Site: weird\r\n${mpH}`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  sfsNoOrigin: `POST /projects HTTP/1.1\r\n${H(`Sec-Fetch-Site: same-origin\r\n${mpH}`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  noOriginNoSfs: `POST /projects HTTP/1.1\r\n${H(`${mpH}`)}Content-Length: ${body.length}\r\n\r\n${body}`,
  xfwd: `POST /projects HTTP/1.1\r\n${H(OR + mpH + 'X-Forwarded-Host: evil.example\r\nX-Forwarded-Proto: https\r\nX-Forwarded-For: ::1\r\nForwarded: for=a;host=b\r\nX-Forwarded-Port: 99999\r\n')}Content-Length: ${body.length}\r\n\r\n${body}`,
  rscHeaders: `GET /projects HTTP/1.1\r\n${H(CK + 'RSC: 1\r\nNext-Router-State-Tree: %5B%22%22%2C%7B%7D%5D\r\nNext-Url: /projects\r\nNext-Router-Prefetch: 1\r\n')}\r\n`,
  rscBadTree: `GET /projects HTTP/1.1\r\n${H(CK + 'RSC: 1\r\nNext-Router-State-Tree: %7Bgarbage\r\n')}\r\n`,
  rscBadTree2: `GET /projects HTTP/1.1\r\n${H(CK + 'RSC: 1\r\nNext-Router-State-Tree: %5B%22%22%5D\r\n')}\r\n`,
  rscBadTree3: `GET / HTTP/1.1\r\n${H('RSC: 1\r\nNext-Router-State-Tree: %FF\r\n')}\r\n`,
  rscBadTree4: `GET /signed-out HTTP/1.1\r\n${H('RSC: 1\r\nNext-Router-State-Tree: ' + encodeURIComponent('[' .repeat(4000)) + '\r\n')}\r\n`,
  rscSegmentPrefetch: `GET /signed-out HTTP/1.1\r\n${H('RSC: 1\r\nNext-Router-Prefetch: 1\r\nNext-Router-Segment-Prefetch: /_tree\r\n')}\r\n`,
  rscSegmentPrefetch2: `GET /signed-out HTTP/1.1\r\n${H('RSC: 1\r\nNext-Router-Prefetch: 1\r\nNext-Router-Segment-Prefetch: ../../x%00\r\n')}\r\n`,
  rscVaryTree: `GET /signed-out.segments/_tree.segment.rsc HTTP/1.1\r\n${H('RSC: 1\r\n')}\r\n`,
  rscDotRsc: `GET /signed-out.rsc HTTP/1.1\r\n${H('')}\r\n`,
  nextData: `GET /_next/data/x/signed-out.json HTTP/1.1\r\n${H('x-nextjs-data: 1\r\n')}\r\n`,
  nextDataReq: `GET /signed-out?__nextDataReq=1 HTTP/1.1\r\n${H('x-nextjs-data: 1\r\n')}\r\n`,
  mwPrefetch: `GET /signed-out HTTP/1.1\r\n${H('x-middleware-prefetch: 1\r\nx-nextjs-data: 1\r\nx-middleware-preflight: 1\r\n')}\r\n`,
  rangeStatic: `GET /_next/static/chunks/x.js HTTP/1.1\r\n${H('Range: bytes=999999999-\r\n')}\r\n`,
  rangeMulti: `GET /signed-out HTTP/1.1\r\n${H('Range: bytes=0-1,5-6,2-3\r\n')}\r\n`,
  rangeBad: `GET /signed-out HTTP/1.1\r\n${H('Range: bytes=abc\r\n')}\r\n`,
  ifNoneMatchBad: `GET /signed-out HTTP/1.1\r\n${H('If-None-Match: ' + 'W/"a",'.repeat(2000) + '\r\nIf-Modified-Since: garbage\r\n')}\r\n`,
  acceptBad: `GET /signed-out HTTP/1.1\r\n${H('Accept: ' + 'a/b;q=0.1,'.repeat(2000) + '\r\nAccept-Language: ;;;,,,\r\nAccept-Encoding: gzip;q=abc, br;q=,\r\n')}\r\n`,
  cookieBad: `GET /projects HTTP/1.1\r\n${H('Cookie: ' + 'a=b;'.repeat(3000) + '\r\n')}\r\n`,
  cookieNul: `GET /projects HTTP/1.1\r\n${H('Cookie: acme_session=\u0000\u0001;\r\n')}\r\n`,
  cookieHugeSession: `GET /projects HTTP/1.1\r\n${H('Cookie: ' + cookie.split('=')[0] + '=' + 'z'.repeat(8000) + '\r\n')}\r\n`,
  cookieQuotes: `GET /projects HTTP/1.1\r\n${H('Cookie: ' + cookie.split('=')[0] + '="' + 'z'.repeat(40) + '"\r\n')}\r\n`,
  cookieDupSession: `GET /projects HTTP/1.1\r\n${H('Cookie: ' + cookie + '; ' + cookie + '\r\n')}\r\n`,
  cookieEncoded: `GET /projects HTTP/1.1\r\n${H('Cookie: ' + cookie.split('=')[0] + '=%E0%A4%A\r\n')}\r\n`,
};
for (const [k, v] of Object.entries(framing)) await R(`framing ${k}`, v);
// ---- paths
const pathList = ['/%', '/%zz', '/%00', '/%ff', '//', '///projects', '/projects//', '/projects/..', '/projects/../projects', '/projects/%2e%2e', '/projects/%2e%2e/%2e%2e/etc/passwd', '/projects/..%2f', '/projects/%252e', '/projects;a=b', '/projects/;', '/projects%2f' + pid, '/%70rojects', '/Projects', '/PROJECTS', '/projects.json', '/projects.rsc', '/projects/index', '/projects?', '/projects?%', '/projects?a[]=1&a[b]=2&a=3', '/projects?returnTo=//evil', '/projects#x', '/_next/static/../../package.json', '/_next/static/%2e%2e/%2e%2e/package.json', '/_next/static/chunks/%00', '/_next/image', '/_next/image?url=%2F&w=64&q=75', '/_next/image?url=http://evil.example/a.png&w=64&q=75', '/_next/image?url=%2F_next%2Fstatic%2Fx&w=1&q=1', '/_next/image?url=' + 'a'.repeat(5000) + '&w=64&q=75', '/_next/image?url=%2F&w=-1&q=75', '/_next/image?url=%2F&w=64&q=0', '/_next/image?url=%2F&w=64&q=75&url=%2F', '/_next/data/x/projects.json', '/_next/webpack-hmr', '/_next/static/chunks/main.js', '/__nextjs_original-stack-frame?file=/etc/passwd', '/__nextjs_launch-editor?file=/etc/passwd', '/api/x', '/robots.txt', '/sitemap.xml', '/.env', '/.git/config', '/favicon.ico', '/favicon.ico/', '/favicon.icoX', '/apple-icon', '/opengraph-image', '/healthz', '/healthz?x=' + 'a'.repeat(9000), '/healthz/', '/auth', '/auth/', '/auth/login', '/auth/login?returnTo=//evil.example', '/auth/login?returnTo=/\\evil.example', '/auth/login?returnTo=javascript:alert(1)', '/auth/login?returnTo=' + 'a'.repeat(9000), '/auth/login?returnTo=%00', '/auth/login?returnTo=%ff', '/auth/login?returnTo=/projects&returnTo=/x', '/auth/login?returnTo[]=x', '/auth/login/extra', '/auth/%00', '/auth/callback', '/auth/callback?code=x&state=y', '/auth/callback?error=access_denied&error_description=' + 'a'.repeat(9000), '/auth/callback?code=x&state=y&iss=a&iss=b', '/auth/callback?state[]=1', '/auth/callback?code=%00&state=%ff', '/auth/callback?' + 'a=b&'.repeat(5000), '/auth/logout', '/auth/refresh', '/signed-out?x=%00', '/sign-in-problem?reason=%00', '/sign-in-problem?reason=' + 'a'.repeat(9000), '/sign-in-problem?reason[]=x', '/sign-in-problem?reason=unavailable&reason=rejected', '/' + 'a'.repeat(7000), '/' + 'a/'.repeat(3500), '/projects/' + 'a'.repeat(7000), '/projects/' + pid + '/extra', '/projects/' + pid + '?x=' + 'a'.repeat(9000), '/projects/' + pid.toUpperCase(), '/projects/' + pid.replace(/-/g, ''), '/projects/{' + pid + '}', '/projects/' + pid + '%00', '/projects/' + pid + '%20'];
for (const p of pathList) for (const cookieOn of [false, true]) {
  await R(`path GET ${p.slice(0, 70)} cookie=${cookieOn}`, `GET ${p} HTTP/1.1\r\n${H(cookieOn ? CK : '')}\r\n`);
  await R(`path HEAD ${p.slice(0, 70)} cookie=${cookieOn}`, `HEAD ${p} HTTP/1.1\r\n${H(cookieOn ? CK : '')}\r\n`);
  await R(`path OPTIONS ${p.slice(0, 70)} cookie=${cookieOn}`, `OPTIONS ${p} HTTP/1.1\r\n${H(cookieOn ? CK : '')}\r\n`);
}
// POSTs of various bodies to every path (no next-action): proxy form-guard + route handlers + page POST
const bodies = { empty: ['', null], json: ['{"a":1}', 'application/json'], jsonBad: ['{', 'application/json'], text: ['hello', 'text/plain'], urlenc: ['a=b&c=d', 'application/x-www-form-urlencoded'], urlencBad: ['%', 'application/x-www-form-urlencoded'], urlencAction: [`$ACTION_ID_${createId}=&_1_name=x`, 'application/x-www-form-urlencoded'], urlencCharset: [`$ACTION_ID_${createId}=&name=x`, 'application/x-www-form-urlencoded; charset=utf-8'], mpGood: [body, 'multipart/form-data; boundary=B'], mpNoAction: [`--B\r\nContent-Disposition: form-data; name="$ACTION_ID_${createId}"\r\n\r\n\r\n--B\r\nContent-Disposition: form-data; name="name"\r\n\r\nx\r\n--B--\r\n`, 'multipart/form-data; boundary=B'], bin: [Buffer.from([0, 255, 254, 1, 2, 3]).toString('latin1'), 'application/octet-stream'], xcomponent: ['["$K1"]', 'text/x-component'], noCT: ['abc', null] };
for (const p of ['/', '/projects', '/projects/' + pid, '/nope', '/auth/login', '/auth/logout', '/auth/refresh', '/auth/callback', '/auth/xyz', '/healthz', '/signed-out', '/sign-in-problem', '/_next/static/x', '/_next/image', '/favicon.ico', '/favicon.icoX', '/_next/staticX']) for (const [bn, [b, ct]] of Object.entries(bodies)) for (const withNA of [false, true]) for (const cookieOn of [false, true]) {
  if (cookieOn && p === '/auth/logout') continue;
  const hdr = OR + (ct ? `Content-Type: ${ct}\r\n` : '') + (withNA ? `Next-Action: ${createId}\r\n` : '') + (cookieOn ? CK : '');
  await R(`POST ${p.slice(0, 30)} body=${bn} NA=${withNA} cookie=${cookieOn}`, `POST ${p} HTTP/1.1\r\n${H(hdr)}Content-Length: ${Buffer.byteLength(b, 'latin1')}\r\n\r\n${b}`);
}
// logout/refresh must not be callable cross-site
for (const op of ['logout', 'refresh']) for (const o of ['https://evil.example', 'null', '']) await R(`xsite POST /auth/${op} origin=${o}`, `POST /auth/${op} HTTP/1.1\r\n${H(CK + (o ? `Origin: ${o}\r\n` : '') + (o ? '' : 'Sec-Fetch-Site: cross-site\r\n'))}Content-Length: 0\r\n\r\n`);
writeFileSync(out + '/results-k.json', JSON.stringify(rows));
const byStatus = rows.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
console.log(JSON.stringify({ total, bad, byStatus }));
console.log(JSON.stringify(rows.filter((r) => r.flag && r.flag !== '5XX').slice(0, 60).map((r) => r.label + ' -> ' + r.flag), null, 0));
