// AC-43: 5,000 unauthenticated GET /auth/login must leave only short-lived (TTL <= 600 s) server state.
// env: WEB (base URL), RPORT (dedicated Redis port), NS (AUTH_NAMESPACE)
import { Asserts, env, OUT, rcli, sleep, hist } from './lib.mjs';
import { writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const A = new Asserts('AC-43');
const WEB = env.WEB, P = env.RPORT, NS = env.NS;
const mem = () => Number(/used_memory:(\d+)/.exec(rcli(P, 'INFO', 'memory'))[1]);
const keys = () => rcli(P, '--scan', '--pattern', NS + ':*').split('\n').filter(Boolean);
const N = 5000, C = 20;
async function burst(h) { let next = 0; async function worker() { while (next < N) { next++; try { const r = await fetch(WEB + '/auth/login', { redirect: 'manual' }); await r.arrayBuffer(); h[r.status] = (h[r.status] || 0) + 1; } catch { h.err = (h.err || 0) + 1; } } } await Promise.all(Array.from({ length: C }, worker)); }
// Redis never shrinks its hash tables after a bulk expiry (measured: +14.9% stayed for 2 min with 0 keys), so a pristine
// baseline would fail any server. Prime the tables with one identical burst, let it expire, and gate on the second burst.
const pristine = mem();
await burst({});
const primeTtl = Math.max(0, ...rcli(P, '--scan', '--pattern', NS + ':*').split('\n').filter(Boolean).slice(0, 50).map((k) => Number(rcli(P, 'TTL', k))));
await sleep((primeTtl + 10) * 1000);
for (let i = 0; i < 60 && keys().length > 0; i++) await sleep(2000);
await sleep(10000);
const baseline = mem(), keys0 = keys().length;
A.note('pristineBaselineBeforePrimingBurst', pristine);
A.check('priming burst fully expired before the measured baseline', keys0 === 0, { keys0 });
writeFileSync(OUT + '/mem-before.txt', `used_memory ${baseline}\nkeys ${keys0}\n`);
const h = {}; const t0 = Date.now();
await burst(h);
A.note('burst', { requests: N, concurrency: C, histogram: h, ms: Date.now() - t0 });
const burstMem = mem(); const ks = keys();
writeFileSync(OUT + '/mem-after-burst.txt', `used_memory ${burstMem}\nkeys ${ks.length}\n`);
A.check('burst created server-side state (otherwise the test proves nothing)', ks.length > 0, { keys: ks.length, histogram: h });
// TTL of every key via one pipelined redis-cli call
const ttlOut = spawnSync('redis-cli', ['-p', P], { input: ks.map((k) => `TTL ${k}`).join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 << 20 }).stdout.split('\n').filter(Boolean).map(Number);
const noTtl = ttlOut.filter((t) => t === -1).length, over = ttlOut.filter((t) => t > 600).length, maxTtl = Math.max(0, ...ttlOut);
writeFileSync(OUT + '/ttl-summary.txt', `keys ${ks.length}\nno TTL (-1): ${noTtl}\nTTL>600: ${over}\nmin/max TTL: ${Math.min(...ttlOut)}/${maxTtl}\nsample of 50 TTLs: ${ttlOut.slice(0, 50).join(' ')}\nprefixes: ${JSON.stringify(hist(ks, (k) => k.split(':').slice(0, 2).join(':').replace(/:[0-9a-f]{16,}$/, ':<id>')))}\n`);
A.check('no key without a TTL', noTtl === 0, { noTtl });
A.check('every key has TTL <= 600 s', over === 0 && maxTtl > 0, { maxTtl, over });
// Wait for the longest TTL, then for the keys to disappear.
const waitMs = (maxTtl + 10) * 1000; console.log(`waiting ${waitMs} ms for the TTL to elapse`);
await sleep(waitMs);
let left = keys().length;
for (let i = 0; i < 60 && left > 0; i++) { await sleep(2000); left = keys().length; }
// Redis shrinks its hash tables lazily: allow up to 120 s of idle time and keep the series.
const series = [mem()];
for (let i = 0; i < 24 && Math.abs(series.at(-1) - baseline) / baseline > 0.10; i++) { await sleep(5000); series.push(mem()); }
const after = series.at(-1);
A.note('memorySeriesAfterExpiry', series);
writeFileSync(OUT + '/mem-after-ttl.txt', `used_memory ${after}\nkeys ${left}\n`);
const delta = Math.abs(after - baseline) / baseline;
A.check('all keys expired after the TTL', left === 0, { left });
A.check('used_memory back within 10% of the baseline', delta <= 0.10, { baseline, burstMem, after, deltaPct: +(delta * 100).toFixed(3) });
A.finish();
