import { send } from './z5lib.mjs';
const O = 'http://localhost:3103';
const cases = {
  'HTTP/0.9 style request line "GET /\\r\\n"': Buffer.from('GET /\r\n'),
  'chunked body with size FFFFFFFFFFFFFFFF': Buffer.from(`POST /projects HTTP/1.1\r\nHost: localhost:3103\r\nOrigin: ${O}\r\nSec-Fetch-Site: same-origin\r\nNext-Action: 00\r\nTransfer-Encoding: chunked\r\n\r\nFFFFFFFFFFFFFFFF\r\nabc\r\n0\r\n\r\n`),
};
const res = await Promise.all(Object.entries(cases).map(async ([k, v]) => [k, await send(v, { timeout: 40000, settle: 100 })]));
for (const [k, r] of res) console.log(k, '->', r.status, r.ms + 'ms', r.head.slice(0, 120));
