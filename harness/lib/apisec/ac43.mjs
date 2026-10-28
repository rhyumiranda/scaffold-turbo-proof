// AC-43: 5,000 unauthenticated GET /auth/login must leave only short-lived (TTL <= 600 s) server state.
// Verdict (literal rule): baseline = INFO memory with the web app started and idle, before the 5,000 requests;
// compare with the same value after the TTL has elapsed; PASS if within 10%.
// Diagnostics (read-only) are written to OUT/diag/*.txt at each stage. A second, identical burst afterwards is supplementary only.
// env: WEB, RPORT (dedicated Redis port), NS (AUTH_NAMESPACE), DIAG=1 for the +300 s sample
import { Asserts, env, OUT, rcli, sleep, hist } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
const A = new Asserts('AC-43');
const WEB = env.WEB, P = env.RPORT, NS = env.NS;
mkdirSync(OUT + '/diag', { recursive: true });
const memInfo = () => Object.fromEntries(rcli(P, 'INFO', 'memory').split('\n').filter((l) => /^[a-z_0-9]+:/.test(l)).map((l) => l.trim().split(':')));
const mem = () => Number(memInfo().used_memory);
const keys = () => rcli(P, '--scan', '--pattern', NS + ':*').split('\n').filter(Boolean);
const safe = (...a) => { try { return rcli(P, ...a); } catch (e) { return 'ERR ' + String(e.message).split('\n')[0]; } };
function snap(label) {
  const t = new Date().toISOString();
  const parts = [`# ${label} at ${t}`, '## INFO memory', safe('INFO', 'memory'), '## MEMORY STATS', safe('MEMORY', 'STATS'), '## INFO keyspace', safe('INFO', 'keyspace'), '## INFO clients', safe('INFO', 'clients'), '## INFO stats (expired/evicted)', safe('INFO', 'stats').split('\n').filter((l) => /expired|evicted|keyspace|total_connections|total_commands/.test(l)).join('\n'), '## DBSIZE', safe('DBSIZE'), '## --scan --count 1000 | head', safe('--scan', '--count', '1000').split('\n').slice(0, 10).join('\n'), '## DEBUG HTSTATS 0 (if enabled)', safe('DEBUG', 'HTSTATS', '0'), '## MEMORY DOCTOR', safe('MEMORY', 'DOCTOR')];
  writeFileSync(`${OUT}/diag/${label}.txt`, parts.join('\n') + '\n');
  const m = memInfo();
  return { label, t, used_memory: Number(m.used_memory), dataset: Number(m.used_memory_dataset), overhead: Number(m.used_memory_overhead), clients: Number(m.mem_clients_normal), scripts: Number(m.used_memory_scripts), aof: Number(m.mem_aof_buffer), hashtable_overhead_est: undefined, frag: m.mem_fragmentation_ratio, allocated: m.allocator_allocated, active: m.allocator_active, resident: m.allocator_resident, dbsize: Number(safe('DBSIZE')) };
}
const N = 5000, C = 20;
// Each request is what a browser sends when it navigates to the sign-in start (fetch() would add Sec-Fetch-Mode: cors,
// which the app rightly treats as not starting a sign-in). h counts statuses and 'started' counts responses that began
// a sign-in: a redirect to the provider that sets a transaction cookie.
const agent = new http.Agent({ keepAlive: true, maxSockets: C });
const get = (url) => new Promise((resolve, reject) => { const r = http.get(url, { agent, headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }, (res) => { res.resume(); res.on('end', () => resolve(res)); }); r.on('error', reject); });
async function burst(h) { let next = 0; async function worker() { while (next < N) { next++; try { const r = await get(WEB + '/auth/login'); h[r.statusCode] = (h[r.statusCode] || 0) + 1; if (r.statusCode === 303 && /\/protocol\/openid-connect\/auth/.test(r.headers.location || '') && (r.headers['set-cookie'] || []).some((c) => /^(__Host-)?oidc_tx_[0-9a-f]{16}=[^;]/.test(c))) h.started = (h.started || 0) + 1; } catch { h.err = (h.err || 0) + 1; } } } await Promise.all(Array.from({ length: C }, worker)); }
const series = [];
const S = (label) => { const s = snap(label); series.push(s); A.note('series', series); return s; };

const before = S('1-before-burst-web-idle');
const baseline = before.used_memory;
writeFileSync(OUT + '/mem-before.txt', `used_memory ${baseline}\nkeys ${keys().length}\n`);
const h = {}; const t0 = Date.now();
await burst(h);
A.note('burst', { requests: N, concurrency: C, histogram: h, ms: Date.now() - t0 });
const ks = keys();
const afterBurst = S('2-after-burst');
writeFileSync(OUT + '/mem-after-burst.txt', `used_memory ${afterBurst.used_memory}\nkeys ${ks.length}\n`);
// The burst must really start sign-ins (otherwise the test proves nothing): every request is a 303 to the provider with
// a transaction cookie. Server-side keys are counted, not required: a stateless start legitimately creates none.
A.check('burst started 5,000 sign-ins (303 to the provider with a transaction cookie each)', h.started === N && h[303] === N, { keys: ks.length, histogram: h });
const ttlOut = spawnSync('redis-cli', ['-p', P], { input: ks.map((k) => `TTL ${k}`).join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 << 20 }).stdout.split('\n').filter(Boolean).map(Number);
const noTtl = ttlOut.filter((t) => t === -1).length, over = ttlOut.filter((t) => t > 600).length, maxTtl = Math.max(0, ...ttlOut);
writeFileSync(OUT + '/ttl-summary.txt', `keys ${ks.length}\nno TTL (-1): ${noTtl}\nTTL>600: ${over}\nmin/max TTL: ${Math.min(...ttlOut)}/${maxTtl}\nsample of 50 TTLs: ${ttlOut.slice(0, 50).join(' ')}\nprefixes: ${JSON.stringify(hist(ks, (k) => k.split(':').slice(0, 2).join(':').replace(/:[0-9a-f]{16,}$/, ':<id>')))}\n`);
A.check('no key without a TTL', noTtl === 0, { noTtl });
A.check('every key has TTL <= 600 s', over === 0 && (ks.length === 0 || maxTtl > 0), { keys: ks.length, maxTtl, over });
console.log('waiting for the TTL to elapse');
await sleep((maxTtl + 10) * 1000);
let left = keys().length;
for (let i = 0; i < 60 && left > 0; i++) { await sleep(2000); left = keys().length; }
const tExpired = Date.now();
const afterExpiry = S('3-after-expiry-0s');
writeFileSync(OUT + '/mem-after-ttl.txt', `used_memory ${afterExpiry.used_memory}\nkeys ${left}\n`);
// Later samples (read-only) to see whether anything shrinks.
for (const sec of [30, 60, 120, ...(env.DIAG ? [300] : [])]) { await sleep(Math.max(0, tExpired + sec * 1000 - Date.now())); S(`4-after-expiry-plus-${sec}s`); }
A.check('all keys expired after the TTL', left === 0, { left });
const finalSample = series.find((x) => x.label.endsWith('plus-120s')) ?? series.at(-1);
const delta = (v) => +(((v - baseline) / baseline) * 100).toFixed(3);
A.check('used_memory after the TTL within 10% of the idle baseline taken before the burst (literal rule; judged on the +0 s and +120 s samples)', Math.abs(delta(afterExpiry.used_memory)) <= 10 && Math.abs(delta(finalSample.used_memory)) <= 10, { baseline, afterExpiry: afterExpiry.used_memory, deltaPctAt0s: delta(afterExpiry.used_memory), plus120: finalSample.used_memory, deltaPctAt120s: delta(finalSample.used_memory) });
// Where the delta lives: field-by-field difference between the baseline and the end of the series.
const last = series.at(-1);
const fields = ['used_memory', 'dataset', 'overhead', 'clients', 'scripts', 'aof', 'allocated', 'active', 'resident'];
const diff = Object.fromEntries(fields.map((f) => [f, { before: Number(before[f]), afterExpiry: Number(afterExpiry[f]), last: Number(last[f]), lastMinusBefore: Number(last[f]) - Number(before[f]) }]));
A.note('deltaByField', diff);
writeFileSync(OUT + '/diag/delta-by-field.json', JSON.stringify({ baseline, deltaPct: delta(last.used_memory), series, diff }, null, 1));
// Supplementary only: a second identical burst after the tables were already grown by the first one.
const h2 = {}; await burst(h2);
const k2 = keys(); const ttl2 = Math.max(0, ...k2.slice(0, 50).map((k) => Number(safe('TTL', k))));
const s2 = snap('5-supplementary-second-burst'); await sleep((ttl2 + 10) * 1000);
for (let i = 0; i < 60 && keys().length > 0; i++) await sleep(2000);
await sleep(10000);
const s3 = snap('6-supplementary-after-second-expiry');
A.note('supplementarySecondBurst', { keysAfterBurst: k2.length, usedBefore: afterExpiry.used_memory, usedAfterSecondExpiry: s3.used_memory, deltaPctVsFirstExpiry: +(((s3.used_memory - afterExpiry.used_memory) / afterExpiry.used_memory) * 100).toFixed(3), deltaPctVsIdleBaseline: delta(s3.used_memory) });
A.finish();
