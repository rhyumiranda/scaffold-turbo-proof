// z5: replay every 5xx raw request of n1 / n2 (class 1: _global-error spellings, class 2/3: POST to matcher-skipped paths) against a server on PORT.
import { Tally, rq } from './z5lib.mjs';
const port = Number(process.env.PORT);
const T = new Tally('verify-patch-' + port, port);
const H = `localhost:${port}`;
const ge = ['/_global-error', '/./_global-error', '/x/../_global-error', '/%2e/_global-error', '/%2E%2E/_global-error', '/projects/../_global-error', '/_global-error#x', '/_global-error/../_global-error', '/_global-error/./', '/a/b/../../_global-error', '/%2e%2e/%2e%2e/_global-error'];
for (const p of ge) for (const m of ['GET', 'HEAD']) for (const x of [{}, { Accept: 'text/html' }, { 'X-Test': '1' }]) await T.run(`${m} ${p} ${JSON.stringify(x)}`, rq({ method: m, target: p, h: { Host: H, ...x } }));
const body = '--BB\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$K1"]\r\n--BB--\r\n';
const bad = ['/favicon.ico', '/favicon.ico/x', '/favicon.ico/..;/projects', '/favicon.ico?/../projects', '/favicon.ico#/../projects', '/_next/image', '/_next/image?url=/', '/_next/imagefoo', '/_next/image/..%2fprojects', '/_next/image%2f..%2fprojects', '/_next/static/x', '/_next/staticx', '/_next/static/chunks/x.js'];
for (const p of bad) for (const ct of ['multipart/form-data', 'multipart/form-data; boundary=BB', 'multipart/form-data; boundary=', 'application/x-www-form-urlencoded', 'text/plain', '']) for (const b of ['x', '', body]) for (const o of [{}, { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', 'Next-Action': '00' }, { Origin: `http://${H}`, 'Sec-Fetch-Site': 'same-origin', 'Next-Action': '00' }])
  await T.run(`POST ${p} ct=${ct} body=${b.length} ${o.Origin ? 'origin' : ''}`, rq({ method: 'POST', target: p, h: { Host: H, ...(ct ? { 'Content-Type': ct } : {}), ...o }, body: b }));
for (const p of ['/healthz', '/favicon.ico', '/_next/image?url=%2F', '/projects', '/nope', '/']) await T.run(`control GET ${p}`, rq({ target: p, h: { Host: H } }));
console.log(JSON.stringify(T.statuses));
T.done();
