// z5 NEW attacks N1: bypasses of the new wrapper checks (/_global-error, percent-escapes, router-state header),
// internal framework headers and query parameters, request-target shapes. Raw TCP, production web :3103.
import { capture, Tally, rq } from './z5lib.mjs';
const c = await capture();
const T = new Tally('n1-wrapper-bypass');
const show = process.env.SHOW === '1';
const run = async (label, buf) => { const r = await T.run(label, buf); if (show) console.log(String(r.status).padEnd(5), label); return r; };
const UUID = '00000000-0000-4000-8000-000000000000';

// ---- N1a: /_global-error spelled so that the wrapper's exact string match misses it
const ge = ['/_global-error', '/_global-error/', '/_global-error//', '/_global-error.rsc', '/_global-error.txt', '/_global-error.segments/_tree.segment.rsc',
  '/_global-error/__PAGE__', '/_global-error/index', '/_global-error/index.txt', '/%5Fglobal-error', '/%5fglobal%2Derror', '/_global%2Derror', '/_global-error%2F', '/_global-error%2f%2f',
  '/./_global-error', '/x/../_global-error', '/%2e/_global-error', '/%2E%2E/_global-error', '/projects/../_global-error', '//_global-error', '///_global-error', '/_global-error;a=b', '/_global-error%00',
  '/_global-error%20', '/_global-error.', '/_Global-Error', '/_GLOBAL-ERROR', '/_global-error?', '/_global-error?a=1', '/_global-error#x', '/_global-error/.', '/_global-error/..', '/_global-error/../_global-error',
  '/projects/_global-error', '/_not-found', '/_not-found/', '/%5Fnot-found', '/_not-found.rsc', '/_error', '/404', '/500', '/_next/static/../_global-error', '/global-error', '/_global-error/page', '/_global-error/layout',
  '/\\_global-error', '/%5C_global-error', '/_global-error%5C', '/_global-error%23', '/_global-error%3F', '/%2F_global-error', '/%2F%2F_global-error', '/_global-error%2e', '/_glob%61l-error', '/%5F%67lobal-error'];
for (const p of ge) for (const m of ['GET', 'HEAD', 'POST', 'OPTIONS']) for (const extra of [{}, { RSC: '1' }, { Accept: 'text/x-component' }, { Cookie: c.cookie }]) {
  const h = { ...extra }; if (m === 'POST') Object.assign(h, { Origin: 'http://localhost:3103', 'Sec-Fetch-Site': 'same-origin', 'Content-Length': '0' });
  await run(`${m} ${p} ${Object.keys(extra).join('+')}`, rq({ method: m, target: p, h }));
}

// ---- N1b: percent-escapes, dot segments, odd bytes in the path, across prefixes
const bad = ['%', '%2', '%G0', '%zz', '%%', '%25%', '%C0%80', '%C1%BF', '%E0%80%80', '%ED%A0%80', '%ED%BF%BF', '%F4%90%80%80', '%F8%88%80%80%80', '%FF', '%FE%FF', '%F0%9F%98', '%F0%9F', '%80', '%BF', '%C2', '%E2%80', '%ED%A0%80%ED%B0%80', '%u0041', '%+', '%%32%35', '%2%35'];
const good = ['%00', '%0a', '%0d%0a', '%09', '%20', '%25', '%2e', '%2e%2e', '%2f', '%2F%2F', '%5c', '%5C..%5C', '%23', '%3f', '%C2%80', '%EF%BB%BF', '%EF%BF%BE', '%EF%BF%BF', '%F4%8F%BF%BF', '%F0%9F%98%80', '%E2%80%AE', '%E2%80%8B', '%CC%81', '%e0%a4%a8', '%7f', '%1b', '%252e', '%25%32%35', 'a%00b', '..', '.', '...', ';', ';a=1', '\\', '%5c%5c', 'a%2Fb', 'a%252Fb', '%c0%ae%c0%ae'];
const prefixes = ['/', '/projects/', '/projects/' + c.pid + '/', '/auth/', '/auth/login/', '/healthz/', '/_next/', '/_next/static/', '/_next/static/chunks/', '/_next/image/', '/sign-in-problem/', '/signed-out/', '/__nextjs_original-stack-frame/', '/_next/data/'];
for (const pre of prefixes) for (const s of [...bad, ...good]) for (const m of ['GET', 'HEAD']) {
  await run(`${m} ${pre}${s}`, rq({ method: m, target: pre + s, h: m === 'GET' ? { Cookie: c.cookie } : {} }));
}
for (const s of [...bad, ...good].slice(0, 30)) await run(`GET unauth ${'/projects/' + s}`, rq({ target: '/projects/' + s }));
// POST + OPTIONS (wrapper runs the same checks for every method)
for (const s of ['%', '%zz', '%C0%AF', '%00', '%2e%2e']) for (const pre of ['/projects/', '/', '/auth/', '/healthz/']) for (const m of ['POST', 'OPTIONS', 'PUT', 'DELETE']) {
  await run(`${m} ${pre}${s}`, rq({ method: m, target: pre + s, h: { Origin: 'http://localhost:3103', 'Sec-Fetch-Site': 'same-origin', 'Content-Length': '0' } }));
}
// raw bytes in the request target (latin1 high bytes, control chars, space-free)
for (let b = 0x01; b <= 0xff; b += 1) {
  if (b === 0x20 || b === 0x0d || b === 0x0a) continue;
  const t = '/p' + String.fromCharCode(b) + 'q';
  await run(`GET raw byte 0x${b.toString(16)} in path`, Buffer.from(`GET ${t} HTTP/1.1\r\nHost: localhost:3103\r\n\r\n`, 'latin1'));
}
for (let b = 0x01; b <= 0xff; b += 7) {
  const t = '/projects?x=' + String.fromCharCode(b) + '&y=%' + String.fromCharCode(b);
  await run(`GET raw byte 0x${b.toString(16)} in query`, Buffer.from(`GET ${t} HTTP/1.1\r\nHost: localhost:3103\r\nCookie: ${c.cookie}\r\n\r\n`, 'latin1'));
}
// long and many-segment paths
for (const n of [1000, 4000, 8000, 15000, 16300, 17000, 70000]) await run(`GET path of ${n} chars`, rq({ target: '/' + 'a'.repeat(n) }));
for (const n of [100, 1000, 5000]) await run(`GET path of ${n} segments`, rq({ target: '/a'.repeat(n) }));
for (const n of [100, 2000, 8000]) await run(`GET path with ${n} encoded slashes`, rq({ target: '/x' + '%2F'.repeat(n) }));
for (const n of [100, 3000, 5000]) await run(`GET /projects/ + ${n} dot-segments`, rq({ target: '/projects/' + '../projects/'.repeat(n) }));
for (const n of [100, 3000, 5000]) await run(`GET query of ${n} params`, rq({ target: '/projects?' + 'a=1&'.repeat(n) }));
for (const n of [10, 1000, 5000]) await run(`GET query ${n} bracket params`, rq({ target: '/projects?' + 'a[]=1&'.repeat(n), h: { Cookie: c.cookie } }));

// ---- N1c: request-target shapes
for (const t of ['*', '', 'http://localhost:3103/', 'http://localhost:3103/projects', 'http://evil.example/', 'https://localhost:3103/', 'ftp://x/', '//', '///', '//evil.example', '//evil.example/x', '//evil.example/%', '/\\evil.example', '/\\/evil.example', '/%5Cevil.example', '/.', '/..', '/../..', '/./', '/projects/./', '/projects/../', '/projects/%2e%2e/', '/projects#frag', '/projects?#', '/projects?a#b', '/#', '/?', '/??', '/?%', '/?a=%', '/?a=%&b=%zz', '/projects?_rsc=', '/projects?_rsc=%', '/projects?_rsc=%zz', '/projects?_rsc=' + 'a'.repeat(5000), '/?__nextLocale=en', '/?__nextDefaultLocale=en', '/?__nextDataReq=1', '/?__flight__=1', '/?__next_data_catchall=1', '/?nxtPid=1', '/?_next=1', '/?__nextInternal=1', '/?__nextFallback=true', '/?_rsc=a&_rsc=b', '/?_rsc[]=a', '/projects/' + UUID + '?_rsc=%', '/projects/' + UUID + '?x[y]=%', '/projects/' + UUID + '/.', '/projects/' + UUID + '/extra', '/projects/' + UUID + '.rsc', '/projects.rsc', '/projects.txt', '/projects/index.txt', '/projects/__PAGE__', '/projects/page', '/index', '/index.html', '/index.rsc', '/.rsc', '/.segments', '/projects.segments/_tree.segment.rsc', '/projects.segments/_index.segment.rsc', '/projects.segments/%.segment.rsc', '/projects.segments/' + '%24d%24id'.repeat(20) + '.segment.rsc', '/_next', '/_next/', '/_next/static', '/_next/static/', '/_next/static/chunks', '/_next/static/chunks/%', '/_next/static/chunks/..%2f..%2fpackage.json', '/_next/static/..%2f..%2f..%2f..%2fetc%2fpasswd', '/_next/static/css/%00', '/_next/image', '/_next/image?', '/_next/image?url=', '/_next/image?url=%2F', '/_next/image?url=/&w=0&q=0', '/_next/image?url=/&w=-1&q=101', '/_next/image?url=/&w=99999999&q=75', '/_next/image?url=/&w=abc&q=abc', '/_next/image?url=//evil.example/x.png&w=64&q=75', '/_next/image?url=http://127.0.0.1:4103/health/live&w=64&q=75', '/_next/image?url=%2F_next%2Fimage%3Furl%3D%252F%26w%3D64%26q%3D75&w=64&q=75', '/_next/image?url=%2Ffavicon.ico&w=64&q=75', '/_next/image?url=' + 'a'.repeat(5000) + '&w=64&q=75', '/_next/image?url=/&url=/&w=64&w=128&q=75', '/_next/image?url[]=/&w=64&q=75', '/_next/data/x/projects.json', '/_next/data/build/index.json', '/_next/webpack-hmr', '/_next/webpack-hmr?id=1', '/_next/server/app/projects.html', '/__nextjs_original-stack-frame?file=x&isServer=true', '/__nextjs_launch-editor?file=/etc/passwd', '/__nextjs_font/x.woff2', '/__nextjs_source-map?filename=x', '/__nextjs_disable_dev_indicator', '/_next/development/x', '/.well-known/x', '/.env', '/package.json', '/robots.txt', '/sitemap.xml', '/favicon.ico', '/manifest.webmanifest', '/icon.png', '/apple-icon.png', '/opengraph-image', '/twitter-image', '/healthz', '/healthz/', '/healthz.rsc', '/healthz?x=%', '/healthz%2F', '/HEALTHZ', '/Projects', '/PROJECTS/', '/PrOjEcTs/' + UUID, '/sign-in-problem?reason=%', '/sign-in-problem?reason=' + 'x'.repeat(9000), '/sign-in-problem?reason[]=a', '/sign-in-problem?reason=unavailable&reason=rejected', '/signed-out?x=%', '/auth', '/auth/', '/auth/x', '/auth/login/x', '/auth/callback?code=%&state=%', '/auth/callback?error=access_denied&error_description=' + 'x'.repeat(9000), '/auth/callback?code=a&code=b&state=c&state=d', '/auth/callback?state[]=a&code[]=b', '/auth/callback?iss=http://evil.example&code=x&state=y', '/auth/logout', '/auth/refresh', '/auth/%5Flogin', '/auth/login?returnTo=%', '/auth/login?returnTo=//evil.example', '/auth/login?returnTo=/\\evil.example', '/auth/login?returnTo=' + 'a'.repeat(20000), '/auth/login?returnTo[]=/x', '/auth/login?returnTo=/x&returnTo=//y', '/auth/login?returnTo=javascript:alert(1)', '/auth/login?returnTo=%0d%0aSet-Cookie:x=1', '/auth/login?returnTo=/projects%0d%0a', '/auth/login?returnTo=/%E0%A4%A', '/auth/login?returnTo=%00', '/auth/login?returnTo=/%2F%2Fevil.example', '/auth/login?returnTo=/%5Cevil.example']) {
  for (const m of ['GET', 'HEAD']) await run(`${m} target ${JSON.stringify(t).slice(0, 80)}`, Buffer.from(`${m} ${t} HTTP/1.1\r\nHost: localhost:3103\r\n\r\n`, 'latin1'));
}
await run('GET authed /projects?_rsc=%', rq({ target: '/projects?_rsc=%', h: { Cookie: c.cookie } }));

// ---- N1d: router-state trees that are valid for the framework's validator but do not match this app
const enc = (v) => encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v));
const trees = [
  ['', { children: ['__PAGE__', {}] }, null, null, true], ['', { children: ['projects', { children: ['__PAGE__', {}] }] }, null, null, true],
  ['', { children: ['projects', { children: [['id', UUID, 'd'], { children: ['__PAGE__', {}] }] }] }, null, null, true],
  ['', { children: ['projects', { children: [['id', 'x', 'd'], { children: ['__PAGE__', {}] }] }] }],
  ['', { children: ['nope', { children: ['__PAGE__', {}] }] }, null, null, true], ['', {}], ['', { a: ['b', {}], children: ['__PAGE__', {}] }],
  ['', { children: ['__PAGE__?{"a":1}', {}] }], ['', { children: ['__DEFAULT__', {}] }], ['', { children: ['/_not-found', { children: ['__PAGE__', {}] }] }, null, 'refetch', true],
  ['', { children: ['projects', { children: ['__PAGE__', {}] }] }, null, 'refresh', true], ['', { children: ['projects', {}] }, null, 'refetch'], ['', { children: ['projects', { children: ['__PAGE__', {}] }] }, '/projects', 'inside-shared-layout', true],
  ['', { children: ['projects', { children: ['__PAGE__', {}] }] }, null, null, false], ['', { children: [['id', '../../x', 'd'], {}] }], ['', { children: [['id', ['a'], 'd'], {}] }],
  ['', { children: [['id', 'x', 'c'], {}] }], ['', { children: [['id', 'x', 'oc'], {}] }], ['', { children: [['id', 'x', 'di(..)(.)'], {}] }], ['', { children: [['id', 'x', 'zz'], {}] }],
  ['', { children: ['__PAGE__', {}] }, null, null, true, 'extra'], ['', { children: ['__PAGE__', {}] }, null, null, true, ['a']],
  ['', { ['__proto__']: ['x', {}], children: ['__PAGE__', {}] }], ['', { constructor: ['x', {}] }], ['', { children: ['projects', { children: ['__PAGE__', {}] }] }, null, null, true, 'x', 'y'],
];
let deep = ['__PAGE__', {}]; for (let i = 0; i < 40; i++) deep = ['seg' + i, { children: deep }];
trees.push(['', { children: deep }, null, null, true]);
const raws = ['', ' ', 'x', '%', '%%%', '[]', '{}', 'null', '"x"', '1', '[""]', '["",{}]', '[1,2,3,4,5]', '["",{},null,null,true]', '%5B%5D', '%5B%22%22%2C%7B%7D%5D', 'a'.repeat(10000), enc('['.repeat(3000)), '%00', '%E0%A4%A', JSON.stringify(['', { children: ['__PAGE__', {}] }]), enc(JSON.stringify(['', { children: ['__PAGE__', {}] }]) + 'x')];
const rscPaths = ['/', '/projects', '/projects/' + c.pid, '/projects/' + UUID, '/projects/not-a-uuid', '/signed-out', '/sign-in-problem', '/nope', '/_not-found', '/auth/login', '/auth/callback', '/healthz', '/projects/%', '/x/y/z'];
const heads = [{ RSC: '1' }, { RSC: '1', 'Next-Router-Prefetch': '1' }, { RSC: '1', 'Next-Router-Prefetch': '2' }, { RSC: '1', 'Next-Router-Segment-Prefetch': '/_tree' }, { RSC: '1', 'Next-Router-Segment-Prefetch': '/_index' }, { RSC: '1', 'Next-Router-Segment-Prefetch': '/$d$id' }, { RSC: '1', 'Next-Router-Segment-Prefetch': '%' }, { RSC: '1', 'Next-Router-Segment-Prefetch': '/' + 'a'.repeat(3000) }, { RSC: '1', 'Next-Url': '/projects' }, { RSC: '1', 'Next-Url': '%' }, { RSC: '1', 'Next-Url': 'http://evil.example/' }, { RSC: '1', 'Next-Hmr-Refresh': '1' }, { RSC: '1', 'X-Nextjs-Data': '1' }, { RSC: '0' }, { RSC: 'x' }, { RSC: '' }, { RSC: '1', 'Next-Resume': '1' }, { RSC: '1', 'X-Nextjs-Html-Request-Id': 'x' }, { RSC: '1', 'X-Deployment-Id': 'x' }, { RSC: '1', 'Next-Router-State-Tree': '' }];
for (const p of rscPaths) {
  for (const t of trees) for (const hh of [{ RSC: '1' }, { RSC: '1', 'Next-Router-Prefetch': '1' }, { RSC: '1', Cookie: c.cookie }, {}]) await run(`RSC tree ${JSON.stringify(t).slice(0, 60)} ${p} ${Object.keys(hh).join('+')}`, rq({ target: p, h: { ...hh, 'Next-Router-State-Tree': enc(t) } }));
  for (const r of raws) for (const hh of [{ RSC: '1' }, { RSC: '1', Cookie: c.cookie }, {}]) await run(`RSC rawtree ${JSON.stringify(r).slice(0, 50)} ${p} ${Object.keys(hh).join('+')}`, rq({ target: p, h: { ...hh, 'Next-Router-State-Tree': r } }));
  for (const hh of heads) for (const ck of [{}, { Cookie: c.cookie }]) await run(`RSC header ${JSON.stringify(hh).slice(0, 80)} ${p} ${Object.keys(ck).join('')}`, rq({ target: p, h: { ...hh, ...ck } }));
}
// duplicated / folded / repeated router-state header and RSC header
const okTree = enc(trees[1]);
await run('two Next-Router-State-Tree headers', Buffer.from(`GET /projects HTTP/1.1\r\nHost: localhost:3103\r\nRSC: 1\r\nNext-Router-State-Tree: ${okTree}\r\nNext-Router-State-Tree: %\r\nCookie: ${c.cookie}\r\n\r\n`));
await run('two Next-Router-State-Tree headers (bad first)', Buffer.from(`GET /projects HTTP/1.1\r\nHost: localhost:3103\r\nRSC: 1\r\nNext-Router-State-Tree: %\r\nNext-Router-State-Tree: ${okTree}\r\nCookie: ${c.cookie}\r\n\r\n`));
await run('router-state header obs-fold', Buffer.from(`GET /projects HTTP/1.1\r\nHost: localhost:3103\r\nRSC: 1\r\nNext-Router-State-Tree: ${okTree}\r\n %\r\nCookie: ${c.cookie}\r\n\r\n`));
await run('router-state header 70KB', rq({ target: '/projects', h: { RSC: '1', 'Next-Router-State-Tree': 'a'.repeat(70000) } }));
await run('router-state header 15KB', rq({ target: '/projects', h: { RSC: '1', 'Next-Router-State-Tree': enc('[' + '"a",'.repeat(2500) + '"b"]') } }));
await run('router-state on POST action', rq({ method: 'POST', target: '/projects', h: { 'Next-Router-State-Tree': '%', Origin: 'http://localhost:3103', 'Sec-Fetch-Site': 'same-origin', 'Content-Length': '0', 'Next-Action': c.createId } }));
await run('router-state on POST, no action', rq({ method: 'POST', target: '/projects', h: { 'Next-Router-State-Tree': '%', Origin: 'http://localhost:3103', 'Sec-Fetch-Site': 'same-origin', 'Content-Length': '0' } }));

// ---- N1e: internal headers and the proxy-bypass header (CVE-2025-29927 style)
const internal = [['x-middleware-subrequest', 'middleware'], ['x-middleware-subrequest', 'src/middleware'], ['x-middleware-subrequest', 'proxy'], ['x-middleware-subrequest', 'src/proxy'],
  ['x-middleware-subrequest', 'middleware:middleware:middleware:middleware:middleware'], ['x-middleware-subrequest', 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware'],
  ['x-middleware-subrequest', 'proxy:proxy:proxy:proxy:proxy'], ['x-middleware-subrequest', 'src/proxy:src/proxy:src/proxy:src/proxy:src/proxy'], ['x-middleware-subrequest', 'pages/_middleware'],
  ['x-middleware-prefetch', '1'], ['x-middleware-skip', '1'], ['x-middleware-rewrite', 'http://evil.example/'], ['x-middleware-rewrite', '/nope'], ['x-middleware-redirect', '/x'], ['x-middleware-set-cookie', 'a=b'], ['x-middleware-override-headers', 'host'],
  ['x-middleware-request-host', 'evil.example'], ['x-nextjs-rewritten-path', '/projects'], ['x-nextjs-rewritten-query', 'a=b'], ['x-nextjs-redirect', '/x'], ['x-nextjs-data', '1'], ['x-nextjs-matched-path', '/projects'], ['x-nextjs-route-type', 'page'], ['x-matched-path', '/projects'],
  ['x-matched-path', '/_global-error'], ['x-matched-path', '/%'], ['x-matched-path', '/projects/[id]'], ['x-now-route-matches', '1=x&2=y'], ['x-now-route-matches', '%'], ['x-invoke-path', '/_global-error'], ['x-invoke-query', '%7B%7D'], ['x-invoke-status', '500'], ['x-invoke-error', '{"message":"x"}'],
  ['x-invoke-output', '/projects'], ['x-vercel-id', 'x'], ['x-vercel-sc-headers', '{}'], ['x-vercel-deployment-url', 'evil.example'], ['x-forwarded-host', 'evil.example'], ['x-forwarded-host', ''], ['x-forwarded-host', 'a,b'], ['x-forwarded-proto', 'https'], ['x-forwarded-proto', 'x'], ['x-forwarded-port', '99999'], ['x-forwarded-port', 'x'],
  ['x-forwarded-for', '::1'], ['x-forwarded-for', 'x'.repeat(5000)], ['x-forwarded-prefix', '/evil'], ['x-original-url', '/_global-error'], ['x-rewrite-url', '/_global-error'], ['x-original-uri', '/%'], ['forwarded', 'host=evil.example;proto=https'], ['forwarded', 'for=x;host=%'],
  ['x-real-ip', 'x'], ['x-request-id', 'xÿ'], ['x-request-id', 'a'.repeat(5000)], ['x-nonce', 'x'], ['content-security-policy', "default-src *"], ['x-http-method-override', 'DELETE'], ['x-method-override', 'PUT'], ['x-http-method', 'TRACE'],
  ['next-router-prefetch', '1'], ['next-router-state-tree', '[]'], ['next-url', '/%'], ['next-action', 'x'], ['next-action', ''], ['accept', 'text/x-component'], ['accept', '*/*;q=%'], ['accept', 'x'.repeat(10000)], ['accept-encoding', 'br;q=x, gzip;q=%'], ['accept-language', '%'], ['content-type', 'text/x-component'],
  ['purpose', 'prefetch'], ['sec-purpose', 'prefetch'], ['x-nextjs-html-request-id', '%'], ['x-deployment-id', '%'], ['if-none-match', 'W/"'], ['if-modified-since', 'x'], ['range', 'bytes=0-'], ['range', 'bytes=999999-1'], ['range', 'bytes=0-0,0-0,0-0'], ['te', 'trailers'], ['connection', 'keep-alive, x-middleware-subrequest'], ['upgrade', 'websocket'], ['upgrade', 'h2c'], ['via', 'x'], ['cookie', 'a=%'], ['cookie', c.cookie + '; ' + c.cookie.split('=')[0] + '=%']];
for (const [k, v] of internal) for (const p of ['/', '/projects', '/projects/' + c.pid, '/nope', '/healthz', '/auth/login', '/signed-out']) for (const ck of [{}, { Cookie: c.cookie }]) {
  if (k === 'cookie' && Object.keys(ck).length) continue;
  await run(`GET ${p} ${k}: ${String(v).slice(0, 30)} ${Object.keys(ck).join('')}`, rq({ target: p, h: { ...ck, [k]: v } }));
}
// writes with the subrequest header must still be rejected cross-site (security check, not only 5xx)
const sec = [];
for (const v of ['middleware', 'src/middleware', 'proxy', 'src/proxy', 'middleware:middleware:middleware:middleware:middleware', 'src/proxy:src/proxy:src/proxy:src/proxy:src/proxy', 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware']) {
  const body = '--BB\r\nContent-Disposition: form-data; name="_1_name"\r\n\r\nn1-evil\r\n--BB\r\nContent-Disposition: form-data; name="0"\r\n\r\n[{"status":"idle","message":""},"$K1"]\r\n--BB--\r\n';
  const r = await run(`CROSS-SITE action with x-middleware-subrequest: ${v}`, rq({ method: 'POST', target: '/projects', h: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'multipart/form-data; boundary=BB', 'Next-Action': c.createId, Cookie: c.cookie, 'x-middleware-subrequest': v }, body }));
  sec.push([v, r.status]);
  const g = await run(`UNAUTH GET /projects with x-middleware-subrequest: ${v}`, rq({ target: '/projects', h: { 'x-middleware-subrequest': v } }));
  sec.push(['GET /projects unauth ' + v, g.status]);
}
console.log('SECURITY (expect 403 / 307):', JSON.stringify(sec));
T.done();
