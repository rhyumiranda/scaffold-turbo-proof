// AC-31: every 4xx/5xx from the API is application/problem+json with type,title,status and a request id that
// matches x-request-id; bodies leak no stack, SQL, file path or library name.
// env: API=http://127.0.0.1:<port> (DB via Toxiproxy), API_RL=http://127.0.0.1:<port> (RATE_LIMIT=3), TOXI=http://127.0.0.1:8474
import net from 'node:net';
import { writeFileSync } from 'node:fs';
import { Asserts, env, OUT, mint, problemShape, LEAK, sleep } from './lib.mjs';

const A = new Asserts('AC-31');
const API = env.API, RL = env.API_RL, TOXI = env.TOXI;
const tok = await mint({ user: 'alice', pass: env.ALICE_PASSWORD });
const H = { authorization: 'Bearer ' + tok };
const rows = [];
async function probe(label, url, init, expectStatuses) {
  let res, text;
  try { res = await fetch(url, { ...init, signal: AbortSignal.timeout(25000) }); text = await res.text(); }
  catch (e) { A.check(`${label}: got a response`, false, String(e.cause?.code || e.message)); return null; }
  const s = problemShape(res, text);
  const leaks = text.match(LEAK);
  const ok = expectStatuses.includes(res.status) && s.isProblemJson && s.hasFields && s.requestIdMatchesHeader && !leaks;
  rows.push({ label, status: res.status, contentType: s.contentType, code: s.json?.code, requestIdMatchesHeader: s.requestIdMatchesHeader, leak: leaks?.[0] ?? null });
  A.check(`${label}: ${expectStatuses.join('|')} problem+json with type/title/status/requestId==x-request-id, no leak`, ok, { status: res.status, ct: s.contentType, fields: s.hasFields, ridMatch: s.requestIdMatchesHeader, leak: leaks?.[0] ?? null, body: ok ? undefined : text.slice(0, 200) });
  return { res, text, s };
}
const post = (body, ct = 'application/json') => ({ method: 'POST', headers: { ...H, 'content-type': ct }, body });
await probe('malformed JSON', API + '/v1/projects', post('{"name":'), [400]);
await probe('33 KB body', API + '/v1/projects', post(JSON.stringify({ name: 'x'.repeat(33 * 1024) })), [413]);
await probe('Content-Type text/plain', API + '/v1/projects', post(JSON.stringify({ name: 'x' }), 'text/plain'), [415]);
await probe('unknown field', API + '/v1/projects', post(JSON.stringify({ name: 'x', extra: 1 })), [400]);
await probe('id=not-a-uuid', API + '/v1/projects/not-a-uuid', { headers: H }, [400, 404]);
await probe('unknown route', API + '/v1/does-not-exist', { headers: H }, [404]);
await probe('unknown route without token', API + '/nope', {}, [401, 404]);
await probe('no token', API + '/v1/projects', {}, [401]);
await probe('well-formed uuid that does not exist', API + '/v1/projects/00000000-0000-4000-8000-000000000000', { headers: H }, [404]);
await probe('method not supported (DELETE /v1/projects)', API + '/v1/projects', { method: 'DELETE', headers: H }, [404, 405]);
const created = await (await fetch(API + '/v1/projects', post(JSON.stringify({ name: 'ac31-conflict' })))).json();
await probe('stale expectedVersion (409)', API + '/v1/projects/' + created.id, { method: 'PATCH', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'ac31-renamed', expectedVersion: 99 }) }, [409]);
// 429 from a second instance with RATE_LIMIT=3
let got429 = null;
for (let i = 0; i < 6 && !got429; i++) { const r = await fetch(RL + '/v1/projects?limit=1', { headers: H }); const t = await r.text(); if (r.status === 429) got429 = { r, t }; }
if (got429) {
  const s = problemShape(got429.r, got429.t); const leaks = got429.t.match(LEAK);
  A.check('429 rate limited: problem+json with type/title/status/requestId==x-request-id, Retry-After, no leak', s.isProblemJson && s.hasFields && s.requestIdMatchesHeader && !leaks && !!got429.r.headers.get('retry-after'), { ct: s.contentType, ridMatch: s.requestIdMatchesHeader });
} else A.check('429 rate limited: instance returned 429', false);
// 408: incomplete request body (raw socket, headers promise 100 bytes, only 10 are sent)
{
  const u = new URL(API);
  const r408 = await new Promise((resolve) => {
    const s = net.connect(Number(u.port), '127.0.0.1'); let buf = ''; const t0 = Date.now();
    s.on('connect', () => s.write(`POST /v1/projects HTTP/1.1\r\nHost: ${u.host}\r\nAuthorization: Bearer ${tok}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"name":"a`));
    s.on('data', (d) => (buf += d)); s.on('close', () => resolve({ buf, ms: Date.now() - t0 })); s.on('error', () => resolve({ buf, ms: Date.now() - t0 }));
    setTimeout(() => s.destroy(), 20000);
  });
  const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(r408.buf)?.[1]);
  const body = r408.buf.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  let j; try { j = JSON.parse(body); } catch {}
  const rid = /x-request-id: (\S+)/i.exec(r408.buf)?.[1];
  rows.push({ label: 'incomplete body', status, ms: r408.ms });
  A.check('408 incomplete request body: problem+json with type/title/status/requestId==x-request-id, no leak', status === 408 && /application\/problem\+json/i.test(r408.buf) && !!j && typeof j.type === 'string' && typeof j.title === 'string' && j.status === 408 && j.requestId === rid && !LEAK.test(body), { status, ms: r408.ms, rid: !!rid });
}
// DB outage through Toxiproxy: disable the proxy, expect 503 problem+json; re-enable and prove recovery.
const toxi = (method, path, body) => fetch(TOXI + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
A.check('toxiproxy: disable the Postgres proxy', (await toxi('POST', '/proxies/pg', { enabled: false })).ok);
let outage = null;
for (let i = 0; i < 4 && !(outage && outage.res.status === 503); i++) { outage = await probe('DB outage (Toxiproxy proxy disabled) attempt ' + (i + 1), API + '/v1/projects?limit=1', { headers: H }, [503]); await sleep(500); }
const retryAfter = outage?.res.headers.get('retry-after');
A.check('DB outage: Retry-After present on the 503', !!retryAfter, { retryAfter });
A.check('toxiproxy: re-enable the Postgres proxy', (await toxi('POST', '/proxies/pg', { enabled: true })).ok);
let recovered = false;
for (let i = 0; i < 20 && !recovered; i++) { await sleep(1000); try { recovered = (await fetch(API + '/v1/projects?limit=1', { headers: H })).status === 200; } catch {} }
A.check('API recovers after the DB comes back', recovered);
A.note('forcedInternalError', 'The API has no test hook that forces an unhandled exception (no route or header triggers a 500); the DB outage path is the only server-fault case reachable from outside.');
writeFileSync(OUT + '/rows.json', JSON.stringify(rows, null, 1));
A.finish();
