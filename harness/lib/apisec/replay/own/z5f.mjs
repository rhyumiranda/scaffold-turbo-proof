// z5 own API probe (round 2k): content-encodings, charsets, JSON shapes, unicode, query shapes, methods, headers against production API :4103
import { Tally, rq, send, out } from './z5lib.mjs';
import zlib from 'node:zlib';
const env = process.env;
const tok = (await (await fetch('http://localhost:8080/realms/acme-z5/protocol/openid-connect/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'password', client_id: 'acme-cli', client_secret: env.ACME_CLI_SECRET, username: 'alice', password: env.ALICE_PASSWORD }) })).json()).access_token;
const T = new Tally('z5f-api', 4103);
const A = { Host: 'localhost:4103', Authorization: 'Bearer ' + tok };
const seed = await fetch('http://127.0.0.1:4103/v1/projects', { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'z5-api-seed' }) }).then((r) => r.json());
const id = seed.id;
const J = 'application/json';
const post = (label, body, h = {}, target = '/v1/projects', method = 'POST') => T.run(label, rq({ method, target, h: { ...A, 'Content-Type': J, ...h }, body }));
const nm = (s) => JSON.stringify({ name: s });
// content-encoding
const gz = (s) => zlib.gzipSync(Buffer.from(s)), df = (s) => zlib.deflateSync(Buffer.from(s)), br = (s) => zlib.brotliCompressSync(Buffer.from(s));
await post('CE gzip valid', gz(nm('z5-gz')), { 'Content-Encoding': 'gzip' });
await post('CE deflate valid', df(nm('z5-df')), { 'Content-Encoding': 'deflate' });
await post('CE br valid', br(nm('z5-br')), { 'Content-Encoding': 'br' });
await post('CE gzip invalid body', Buffer.from('not gzip'), { 'Content-Encoding': 'gzip' });
await post('CE gzip truncated', gz(nm('z5-trunc')).subarray(0, 12), { 'Content-Encoding': 'gzip' });
await post('CE gzip empty', Buffer.alloc(0), { 'Content-Encoding': 'gzip' });
await post('CE unknown', Buffer.from(nm('x')), { 'Content-Encoding': 'zstd' });
await post('CE identity', Buffer.from(nm('z5-id')), { 'Content-Encoding': 'identity' });
await post('CE gzip,gzip', gz(gz(nm('x')).toString('latin1')), { 'Content-Encoding': 'gzip, gzip' });
await post('CE gzip bomb 100MB zeros', zlib.gzipSync(Buffer.alloc(100 * 1024 * 1024)), { 'Content-Encoding': 'gzip' });
await post('CE gzip bomb 1GB zeros', zlib.gzipSync(Buffer.alloc(1024 * 1024 * 1024), { level: 9 }), { 'Content-Encoding': 'gzip' });
await post('CE br bomb 100MB', zlib.brotliCompressSync(Buffer.alloc(100 * 1024 * 1024)), { 'Content-Encoding': 'br' });
await post('CE deflate invalid', Buffer.from('xx'), { 'Content-Encoding': 'deflate' });
await post('CE br invalid', Buffer.from('xx'), { 'Content-Encoding': 'br' });
// charset / content-type
for (const ct of ['application/json; charset=utf-8', 'application/json; charset=UTF-8', 'application/json; charset=utf-16', 'application/json; charset=latin1', 'application/json; charset=foo', 'application/json; charset=', 'application/json;charset="utf-8"', 'application/JSON', 'application/vnd.api+json', 'application/json, text/plain', 'application/json; boundary=x', 'text/json', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'text/plain', '', 'x', 'application/json; charset=utf-7', 'application/json; charset=ucs-2'])
  await post('CT ' + ct, Buffer.from(nm('z5-ct')), { 'Content-Type': ct });
await T.run('CT none', rq({ method: 'POST', target: '/v1/projects', h: { ...A, 'Content-Type': null }, body: nm('x') }));
await post('CT utf-16le body w/ charset utf-16le', Buffer.from(nm('z5-u16'), 'utf16le'), { 'Content-Type': 'application/json; charset=utf-16le' });
await post('body BOM', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(nm('z5-bom'))]));
await post('body utf16 BOM', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(nm('z5-bom16'), 'utf16le')]));
await post('body invalid utf8', Buffer.concat([Buffer.from('{"name":"a'), Buffer.from([0xff, 0xfe, 0xc0, 0x80]), Buffer.from('"}')]));
await post('body lone surrogate escape', Buffer.from('{"name":"a\\ud800b"}'));
await post('body NUL escape', Buffer.from('{"name":"a\\u0000b"}'));
await post('body dup keys', Buffer.from('{"name":"a","name":"b"}'));
await post('body __proto__', Buffer.from('{"name":"a","__proto__":{"x":1}}'));
await post('body constructor', Buffer.from('{"name":"a","constructor":{"prototype":{"x":1}}}'));
await post('body huge number', Buffer.from('{"name":1e999}'));
await post('body big int', Buffer.from('{"name":"a","expectedVersion":99999999999999999999999}'));
await post('body trailing comma', Buffer.from('{"name":"a",}'));
await post('body trailing garbage', Buffer.from('{"name":"a"}xx'));
await post('body two docs', Buffer.from('{"name":"a"}{"name":"b"}'));
await post('body comments', Buffer.from('{"name":"a"/*x*/}'));
await post('body NaN', Buffer.from('{"name":NaN}'));
await post('body single quotes', Buffer.from("{'name':'a'}"));
await post('body 100 emoji (400 bytes)', Buffer.from(nm('😀'.repeat(100))));
await post('body 101 emoji', Buffer.from(nm('😀'.repeat(101))));
await post('body 100 astral + RTL', Buffer.from(nm('‮' + 'a'.repeat(99))));
await post('body 50 ZWJ families', Buffer.from(nm('👩‍👩‍👧‍👦'.repeat(10))));
await post('body only zero-width', Buffer.from(nm('​​')));
await post('body only nbsp/ideographic', Buffer.from(nm(' 　')));
await post('body line separators', Buffer.from(nm('a b c')));
await post('body NEL/VT/FF', Buffer.from(nm('a\u0085\u000b\u000cb')));
await post('body DEL/C1', Buffer.from(nm('a\u007f\u0090b')));
await post('body non-char U+FFFE', Buffer.from(nm('a￾b')));
await post('body unnormalized combining x200', Buffer.from(nm('e' + '́'.repeat(200))));
await post('body 100 combining marks', Buffer.from(nm('é'.repeat(50))));
await post('body 1 char over: 101 combining-only', Buffer.from(nm('́'.repeat(101))));
await post('body name with SQL', Buffer.from(nm("'); DROP TABLE projects;--")));
await post('body name null-ish', Buffer.from(nm('null')));
await post('body very deep object 200 levels', Buffer.from('{"name":' + '{"a":'.repeat(200) + '1' + '}'.repeat(200) + '}'));
await post('body 5000 keys', Buffer.from('{' + Array.from({ length: 5000 }, (_, i) => `"k${i}":1`).join(',') + ',"name":"a"}'));
await post('body array of 100k', Buffer.from('[' + '1,'.repeat(100000) + '1]'));
await post('body 31 KB', Buffer.from(nm('x'.repeat(31 * 1024))));
await post('body 33 KB', Buffer.from(nm('x'.repeat(33 * 1024))));
await post('body 100 KB', Buffer.from(nm('x'.repeat(100 * 1024))));
await post('body 1 MB', Buffer.from(nm('x'.repeat(1024 * 1024))));
await post('body 20 MB', Buffer.from(nm('x'.repeat(20 * 1024 * 1024))));
// queries
for (const q of ['limit=0', 'limit=-1', 'limit=1.5', 'limit=1e2', 'limit=0x10', 'limit=+5', 'limit=%205', 'limit=5%20', 'limit=', 'limit=null', 'limit[]=1', 'limit[a]=1', 'limit=1&limit=2', 'offset=1e400', 'offset=-0', 'offset=2147483648', 'offset=9007199254740993', 'offset=%00', 'offset=%', 'limit=%zz', '%', '&&&', '=', 'a=1&a=2&a=3', 'cursor=x', 'sort=name', 'q=%00', 'limit=' + '9'.repeat(400), '__proto__=1', 'constructor[prototype][x]=1', 'limit=1#frag'])
  for (const m of ['GET', 'HEAD']) await T.run(`Q ${m} ?${q.slice(0, 40)}`, rq({ method: m, target: '/v1/projects?' + q, h: A }));
for (const p of ['/v1/projects/' + id, '/v1/projects/' + id.toUpperCase(), '/v1/projects/%00', '/v1/projects/%', '/v1/projects/%zz', '/v1/projects/' + id + '/', '/v1/projects/' + id + '/x', '/v1/projects//', '/v1//projects', '/v1/projects/..', '/v1/projects/%2e%2e', '/v1/projects/' + 'a'.repeat(5000), '/v1/projects/0', '/v1/projects/-1', '/v1/projects/null', '/v1/projects/undefined', '/v1/projects/{id}', '/v1/projects/*', '/v1/Projects', '/V1/projects', '/v2/projects', '/v1', '/v1/', '/', '/health', '/health/live/x', '/health/ready', '/health/%', '/health/live?x=%', '/openapi.json', '/docs', '/metrics', '/%', '/%00', '/a%2fb', '/\\', '/*', '/v1/projects;x=1', '/v1/projects?', '/v1/projects??', '/v1/projects/%E0%A4%A', '/v1/projects/%c0%af'])
  for (const m of ['GET', 'HEAD', 'OPTIONS', 'DELETE', 'PUT', 'PATCH', 'POST']) await T.run(`P ${m} ${p.slice(0, 50)}`, rq({ method: m, target: p, h: { ...A, ...(['PUT', 'PATCH', 'POST'].includes(m) ? { 'Content-Type': J } : {}) }, body: ['PUT', 'PATCH', 'POST'].includes(m) ? '{}' : null }));
for (const [k, v] of Object.entries({ Authorization: ['Bearer', 'Bearer ', 'bearer ' + tok, 'Bearer ' + tok + 'x', 'Bearer ' + tok.slice(0, -3), 'Bearer a.b.c', 'Bearer ..', 'Basic xx', tok, 'Bearer ' + tok + ', Bearer ' + tok, 'Bearer\t' + tok, 'Bearer  ' + tok], 'X-Request-Id': ['x', 'a'.repeat(5000), 'é', ''], 'Idempotency-Key': ['x', 'a'.repeat(5000), ''], 'If-Match': ['*', '"x"', 'W/"1"', 'x'.repeat(5000), ''], 'If-None-Match': ['*', 'x'], 'Accept': ['application/xml', 'text/html', '*/*;q=0', 'a'.repeat(5000), 'application/json;q=x'], 'Accept-Language': ['xx', 'a'.repeat(5000)], 'Accept-Encoding': ['br;q=0', 'identity;q=0', 'gzip;q=x', 'zstd', '*'], 'Origin': ['null', 'http://localhost:3000', 'x', 'a'.repeat(5000)], 'Access-Control-Request-Method': ['POST'], 'Content-Length': [], 'Range': ['bytes=0-1', 'bytes=x'], 'X-HTTP-Method-Override': ['DELETE', 'PUT'], 'Traceparent': ['00-00000000000000000000000000000000-0000000000000000-00', 'x', '00-' + 'f'.repeat(32) + '-' + 'f'.repeat(16) + '-01', 'a'.repeat(5000)], 'Tracestate': ['a=b', 'x'.repeat(5000), '='], 'Baggage': ['a=b', 'x'.repeat(5000)] })) for (const val of v)
  for (const m of ['GET', 'POST']) await T.run(`H ${k}=${JSON.stringify(val).slice(0, 30)} ${m}`, rq({ method: m, target: '/v1/projects' + (m === 'GET' ? '' : ''), h: { ...A, [k]: val, ...(k === 'Authorization' ? { Authorization: val } : {}), ...(m === 'POST' ? { 'Content-Type': J } : {}) }, body: m === 'POST' ? nm('z5-h') : null }));
for (const h of ['localhost:4103', 'evil.example', '', 'localhost:4103, evil', 'a'.repeat(5000)]) await T.run(`Host=${h.slice(0, 20)}`, rq({ target: '/health/live', h: { Host: h } }));
console.log(JSON.stringify(T.done()));
