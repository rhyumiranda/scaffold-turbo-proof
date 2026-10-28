// slow / partial clients against the web (3103) and API (4103): record time to first response / to close; flag anything still open after 45 s
import net from 'node:net';
import { writeFileSync } from 'node:fs';
const out = process.env.OUT;
function probe(label, port, chunks, { max = 45000 } = {}) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1'); const t0 = Date.now(); let first = null, buf = '', closed = false;
    const finish = (why) => { if (closed) return; closed = true; clearTimeout(timer); s.destroy(); resolve({ label, port, firstByteMs: first, endMs: Date.now() - t0, why, head: buf.slice(0, 80).replace(/\r\n/g, ' | ') }); };
    s.on('data', (d) => { if (first === null) first = Date.now() - t0; buf += d.toString('latin1'); });
    s.on('close', () => finish('closed-by-server')); s.on('error', (e) => finish('error ' + e.code));
    const timer = setTimeout(() => finish('STILL-OPEN-at-' + max), max);
    s.on('connect', async () => { for (const [delay, data] of chunks) { await new Promise((r) => setTimeout(r, delay)); if (closed) return; s.write(data); } });
  });
}
const H = 'Host: localhost:3103\r\n', ct = 'multipart/form-data; boundary=BB';
const jobs = [];
for (const port of [3103, 4103]) {
  const host = port === 3103 ? H : 'Host: localhost:4103\r\n';
  jobs.push(probe('no bytes at all', port, [], { max: 45000 }));
  jobs.push(probe('partial request line then idle', port, [[0, 'GET / HT']]));
  jobs.push(probe('headers incomplete (no final CRLF) then idle', port, [[0, `GET / HTTP/1.1\r\n${host}X-A: b\r\n`]]));
  jobs.push(probe('headers trickled 1 byte / 2s forever', port, Array.from({ length: 40 }, (_, i) => [2000, i === 0 ? 'G' : 'E'])));
  jobs.push(probe('POST CL 100, 10 bytes sent then idle', port, [[0, `POST /${port === 3103 ? 'projects' : 'v1/projects'} HTTP/1.1\r\n${host}Content-Type: application/json\r\nContent-Length: 100\r\n\r\n0123456789`]]));
  jobs.push(probe('POST CL 5000000 (over cap), 10 bytes then idle', port, [[0, `POST /${port === 3103 ? 'projects' : 'v1/projects'} HTTP/1.1\r\n${host}Content-Type: ${ct}\r\nContent-Length: 5000000\r\n\r\n0123456789`]]));
  jobs.push(probe('body trickled 1 byte / 1s', port, [[0, `POST /${port === 3103 ? 'projects' : 'v1/projects'} HTTP/1.1\r\n${host}Content-Type: application/json\r\nContent-Length: 60\r\n\r\n`], ...Array.from({ length: 55 }, () => [1000, 'x'])]));
  jobs.push(probe('Expect 100-continue then idle', port, [[0, `POST /${port === 3103 ? 'projects' : 'v1/projects'} HTTP/1.1\r\n${host}Expect: 100-continue\r\nContent-Type: application/json\r\nContent-Length: 50\r\n\r\n`]]));
  jobs.push(probe('chunked body, no terminator, idle', port, [[0, `POST /${port === 3103 ? 'projects' : 'v1/projects'} HTTP/1.1\r\n${host}Transfer-Encoding: chunked\r\nContent-Type: application/json\r\n\r\n5\r\nhello\r\n`]]));
  jobs.push(probe('keep-alive: 1 GET then idle', port, [[0, `GET /${port === 3103 ? 'healthz' : 'health/live'} HTTP/1.1\r\n${host}\r\n`]], { max: 80000 }));
  jobs.push(probe('upgrade websocket then idle', port, [[0, `GET / HTTP/1.1\r\n${host}Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`]]));
  jobs.push(probe('CONNECT then idle', port, [[0, `CONNECT localhost:80 HTTP/1.1\r\n${host}\r\n`]]));
  jobs.push(probe('h2c preface then idle', port, [[0, 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n']]));
}
const res = await Promise.all(jobs);
for (const r of res) console.log(JSON.stringify(r));
writeFileSync(out + '/z5d-slow.json', JSON.stringify(res, null, 1));
