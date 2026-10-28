// Raw-socket sweep of request targets, hosts, headers and methods. Usage: node sweep.mjs <port> <createId>
import net from 'node:net';
const [port, action] = process.argv.slice(2);
const send = (raw) => new Promise((resolve) => {
  const s = net.connect(Number(port), '127.0.0.1', () => s.write(raw));
  let data = ''; const t = setTimeout(() => { s.destroy(); resolve('TIMEOUT'); }, 8000);
  s.on('data', (d) => { data += d; }); s.on('error', () => {});
  s.on('close', () => { clearTimeout(t); resolve(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? 'NONE'); });
  setTimeout(() => s.end(), 1500);
});
const o = `http://localhost:${port}`;
const B = '----WebKitFormBoundaryAbc123';
const body = `--${B}\r\nContent-Disposition: form-data; name="0"\r\n\r\n["$undefined","$K1"]\r\n--${B}\r\nContent-Disposition: form-data; name="_1_name"\r\n\r\nSweep\r\n--${B}--\r\n`;
const post = (target, host, extra = '') => `POST ${target} HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${o}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: ${action}\r\nContent-Type: multipart/form-data; boundary=${B}\r\nContent-Length: ${Buffer.byteLength(body)}\r\n${extra}Connection: close\r\n\r\n${body}`;
const get = (target, host = `localhost:${port}`, method = 'GET', extra = '') => `${method} ${target} HTTP/1.1\r\nHost: ${host}\r\n${extra}Connection: close\r\n\r\n`;
const cases = [];
for (const t of ['*', 'http://localhost/projects', '//evil/projects', '/projects?%', '/%', '/%00', '/..%2f', '/projects/%2e%2e', '/' + 'a'.repeat(8000), '/_next/data/x/projects.json', '/_next/static/../../etc/passwd', '/_next/image?url=%2F&w=64&q=75', '/_next/image?url=http://evil/x.png&w=64&q=75', '/_next/image?url=%2Fprojects&w=1&q=1', '/_next/image', '/favicon.ico', '/healthz?x=%ff', '/auth/login?returnTo=%', '/auth/callback?code=%&state=%', '/projects?page=%', '/__nextjs_original-stack-frame', '/_next/webpack-hmr', '/api/x', '/robots.txt'])
  for (const m of ['GET', 'HEAD', 'OPTIONS', 'POST']) cases.push([`${m} ${t.slice(0, 40)}`, get(t, `localhost:${port}`, m, m === 'POST' ? 'Content-Length: 0\r\n' : '')]);
for (const h of ['evil.example', '127.0.0.1:' + port, '[::1]:' + port, '', 'localhost:' + port + ', evil', 'localhost:99999', 'local host'])
  cases.push([`POST action Host=${h}`, post('/projects', h)]);
for (const x of ['X-Forwarded-Host: evil\r\n', `X-Forwarded-Host: localhost:${port}, evil\r\n`, 'X-Forwarded-Proto: gopher\r\n', 'Forwarded: host=evil\r\n', 'Upgrade: websocket\r\nConnection: Upgrade\r\n', 'Expect: 100-continue\r\n', 'Transfer-Encoding: chunked\r\n', `Content-Length: ${Buffer.byteLength(body)}\r\n`, 'Next-Router-State-Tree: %%%\r\n', 'Next-Router-State-Tree: [1,2\r\n', 'RSC: 1\r\n', 'Next-Router-Prefetch: 1\r\n', 'Next-Url: //evil\r\n', 'Accept: text/x-component\r\n', 'Cookie: __Host-app_session=' + 'x'.repeat(5000) + '\r\n', 'X-Request-Id: \u0000\r\n'])
  cases.push([`POST action + ${x.slice(0, 30).replace(/\r\n/g, '')}`, post('/projects', `localhost:${port}`, x)]);
for (const x of ['RSC: 1\r\n', 'Next-Router-State-Tree: %%%\r\n', 'Next-Router-State-Tree: [1,2\r\n', 'Next-Router-Prefetch: 1\r\nRSC: 1\r\n', 'Next-Url: //evil\r\nRSC: 1\r\n', 'Next-Router-Segment-Prefetch: /x\r\nRSC: 1\r\n', 'Accept: text/x-component\r\n'])
  for (const t of ['/', '/projects', '/projects/00000000-0000-4000-8000-000000000000', '/nope'])
    cases.push([`GET ${t} + ${x.slice(0, 26).replace(/\r\n/g, ' ')}`, get(t, `localhost:${port}`, 'GET', x)]);
const results = {}; const bad = [];
for (const [label, raw] of cases) { const status = await send(raw); results[status] = (results[status] ?? 0) + 1; if (/^5|TIMEOUT|NONE/.test(status)) bad.push(`${status} ${label}`); }
console.log(JSON.stringify(results)); for (const b of bad) console.log('  ', b);
