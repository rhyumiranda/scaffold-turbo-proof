// AC-42: rate limits and overload protection. usage: node ac42.mjs <phase>
// phases: single | xff | dual | outage | overload.   env: P_A, P_B (API ports), LIM_REDIS (container name), TOXI.
// Every phase polls /health/live every 200 ms on the instances under test; liveness must stay 200.
import { execFileSync } from 'node:child_process';
import { Asserts, env, OUT, mint, livePoller, hist, sleep } from './lib.mjs';
const phase = process.argv[2];
const A = new Asserts('AC-42');
const PA = env.P_A, PB = env.P_B;
const ports = [PA, PB].filter(Boolean);
const alice = await mint({ user: 'alice', pass: env.ALICE_PASSWORD }), bob = await mint({ user: 'bob', pass: env.BOB_PASSWORD });
async function hit(port, token, extra = {}) {
  const r = await fetch(`http://127.0.0.1:${port}/v1/projects?limit=1`, { headers: { authorization: 'Bearer ' + token, ...extra }, signal: AbortSignal.timeout(30000) });
  await r.arrayBuffer();
  return { status: r.status, retryAfter: r.headers.get('retry-after'), ct: r.headers.get('content-type') };
}
const ok = (a) => a.filter((x) => x.status === 200).length;
const poll = livePoller(ports);
const exact = (label, arr, n) => A.check(`${phase}: ${label}: exactly ${n} x 200`, ok(arr) === n, hist(arr));
if (phase === 'single') {
  const a = []; for (let i = 0; i < 25; i++) a.push(await hit(PA, alice));
  exact('25 requests, one token, RATE_LIMIT=20', a, 20);
  const r429 = a.filter((x) => x.status === 429);
  A.check('single: the 5 excess requests are 429 with Retry-After and problem+json', r429.length === 5 && r429.every((x) => x.retryAfter && /application\/problem\+json/.test(x.ct || '')), { n429: r429.length, retryAfter: [...new Set(r429.map((x) => x.retryAfter))] });
  const b = []; for (let i = 0; i < 25; i++) b.push(await hit(PA, bob));
  exact('a second identity (bob) has its own quota', b, 20);
}
if (phase === 'xff') {
  const a = [];
  for (let i = 0; i < 25; i++) a.push(await hit(PA, alice, { 'x-forwarded-for': `${1 + ((i * 7) % 223)}.${i}.${(i * 13) % 255}.${i + 1}`, 'x-real-ip': `10.0.${i}.1`, forwarded: `for=192.0.2.${i}` }));
  exact('25 requests with a different random X-Forwarded-For/X-Real-IP/Forwarded each', a, 20);
}
if (phase === 'dual') {
  const a = [], b = [];
  for (let i = 0; i < 15; i++) { a.push(await hit(PA, alice)); b.push(await hit(PB, alice)); }
  A.check('dual: two Redis-mode instances share one quota (20 successes in total)', ok(a) + ok(b) === 20, { instanceA: hist(a), instanceB: hist(b) });
  A.check('dual: the excess is 429 with Retry-After', [...a, ...b].filter((x) => x.status === 429).length === 10 && [...a, ...b].filter((x) => x.status === 429).every((x) => x.retryAfter));
}
if (phase === 'outage') {
  const before = []; for (let i = 0; i < 3; i++) before.push(await hit(PA, bob));
  const rb = await fetch(`http://127.0.0.1:${PA}/health/ready`);
  A.check('outage: before the stop, requests succeed and readiness is 200', ok(before) === 3 && rb.status === 200, { requests: hist(before), ready: rb.status });
  execFileSync('docker', ['stop', '-t', '1', env.LIM_REDIS]);
  const during = [];
  for (let i = 0; i < 30; i++) during.push(await hit(i % 2 ? PB : PA, i % 3 ? bob : alice));
  const ra = await fetch(`http://127.0.0.1:${PA}/health/ready`), rbb = await fetch(`http://127.0.0.1:${PB}/health/ready`);
  A.check('outage: Redis stopped, all 30 requests fail closed with 503 (never an unlimited 200)', during.every((x) => x.status === 503), hist(during));
  A.check('outage: the 503s carry Retry-After', during.every((x) => !!x.retryAfter), [...new Set(during.map((x) => x.retryAfter))]);
  A.check('outage: readiness is 503 on both instances', ra.status === 503 && rbb.status === 503, { a: ra.status, b: rbb.status });
  execFileSync('docker', ['start', env.LIM_REDIS]); await sleep(4000);
  const after = []; for (let i = 0; i < 3; i++) after.push(await hit(PA, bob));
  A.note('outageRecovery', { afterRestart: hist(after), ready: (await fetch(`http://127.0.0.1:${PA}/health/ready`)).status });
}
if (phase === 'overload') {
  const toxi = (m, p, b) => fetch(env.TOXI + p, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) });
  for (let i = 0; i < 3; i++) await hit(PA, alice); // warm the pool
  await toxi('POST', '/proxies/pg/toxics', { name: 'lat', type: 'latency', stream: 'downstream', attributes: { latency: 2500, jitter: 0 } });
  const t0 = Date.now();
  const all = await Promise.all(Array.from({ length: 20 }, async () => { const t = Date.now(); const r = await hit(PA, alice); return { ...r, ms: Date.now() - t }; }));
  await toxi('DELETE', '/proxies/pg/toxics/lat');
  const s503 = all.filter((x) => x.status === 503);
  A.check('overload: MAX_IN_FLIGHT=5, 20 concurrent requests held by 2.5 s DB latency: only 200 or 503 answers', all.every((x) => x.status === 200 || x.status === 503), hist(all));
  A.check('overload: at least 15 of the 20 are rejected with 503', s503.length >= 15, { n503: s503.length });
  A.check('overload: every 503 has Retry-After', s503.every((x) => !!x.retryAfter), [...new Set(s503.map((x) => x.retryAfter))]);
  A.check('overload: the shed requests are fast (< 1 s)', s503.filter((x) => x.retryAfter === '1').every((x) => x.ms < 1000), s503.map((x) => x.ms).sort((a, b) => a - b).slice(0, 5));
  A.note('overload', { hist: hist(all), totalMs: Date.now() - t0 });
}
const live = await poll.stop();
const bad = live.filter((x) => x.s !== 200);
A.check(`${phase}: /health/live stayed 200 on every poll (${live.length} polls)`, live.length > 0 && bad.length === 0, { polls: live.length, nonOk: bad.slice(0, 5), maxMs: Math.max(0, ...live.map((x) => x.ms)) });
A.finish();
