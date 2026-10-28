// AC-38: record-level authorization (bob vs alice's project) through the API and the web Server Action.
import { writeFileSync } from 'node:fs';
import { Asserts, env, OUT, chromium, kcLogin, mint, decode, sql } from './lib.mjs';
const A = new Asserts('AC-38');
const BASE = env.WEB, API = env.API, DB = env.DB;
const log = [];
async function api(label, token, method, path, body, extra = {}) {
  const r = await fetch(API + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch {}
  log.push({ label, status: r.status }); return { status: r.status, j };
}
const browser = await chromium.launch();
const alice = await browser.newContext({ recordVideo: { dir: OUT + '/video' } }); await alice.tracing.start({ screenshots: true, snapshots: true });
try {
  const ap = await alice.newPage();
  await ap.goto(BASE + '/auth/login'); await kcLogin(ap, 'alice', env.ALICE_PASSWORD); await ap.waitForURL(BASE + '/projects');
  await ap.getByLabel('Project name').fill('P-alice-AC38'); await ap.getByRole('button', { name: 'Create project' }).click();
  const link = ap.getByRole('link', { name: 'Open created project' }); await link.waitFor();
  const P = (await link.getAttribute('href')).split('/').pop();
  await ap.goto(BASE + '/projects/' + P);
  let cap;
  await ap.route((u) => u.pathname === '/projects/' + P, async (route) => { const rq = route.request(); if (rq.method() === 'POST' && rq.headers()['next-action']) { cap = { url: rq.url(), headers: await rq.allHeaders(), body: rq.postDataBuffer() }; await route.abort(); } else await route.continue(); });
  await ap.getByLabel('Project name').fill('RENAMED-BY-REPLAY'); await ap.getByRole('button', { name: 'Save name' }).click();
  for (let i = 0; i < 50 && !cap; i++) await ap.waitForTimeout(100);
  A.check("captured alice's rename Server Action request", !!cap);
  const row0 = sql(DB, `SELECT owner_id||'|'||name||'|'||version FROM projects WHERE id='${P}'`);
  const bob = await browser.newContext(); const bp = await bob.newPage();
  await bp.goto(BASE + '/auth/login'); await kcLogin(bp, 'bob', env.BOB_PASSWORD); await bp.waitForURL(BASE + '/projects');
  A.check("bob's project page does not list P", !(await bp.locator('main').innerText()).includes('P-alice-AC38'));
  const hdrs = Object.fromEntries(Object.entries(cap.headers).filter(([k]) => !['cookie', 'content-length', 'host'].includes(k)));
  const br = await bob.request.post(cap.url, { headers: hdrs, data: cap.body, maxRedirects: 0 }); const bt = await br.text();
  log.push({ label: 'bob replays rename action', status: br.status(), excerpt: bt.slice(0, 200) });
  A.check("bob's replay of alice's rename action returns a safe error (not success, no 5xx, no stack)", br.status() < 500 && !/"status":"success"|Project renamed/.test(bt) && !/\n\s+at |node_modules/.test(bt), { status: br.status(), safe: /not found|error/i.test(bt) });
  const at = await mint({ user: 'alice' }), bt2 = await mint({ user: 'bob', pass: env.BOB_PASSWORD });
  const aSub = decode(at).sub, bSub = decode(bt2).sub;
  const list = await api('bob GET list', bt2, 'GET', '/v1/projects?limit=100');
  A.check('P absent from the bob list', Array.isArray(list.j) && !list.j.some((p) => p.id === P));
  const g = await api('bob GET P', bt2, 'GET', '/v1/projects/' + P);
  const p = await api('bob PATCH P', bt2, 'PATCH', '/v1/projects/' + P, { name: 'bob-was-here', expectedVersion: 1 });
  A.check('bob GET and PATCH on P give the same denial (404, or 403 consistently)', g.status === p.status && [403, 404].includes(g.status), { get: g.status, patch: p.status });
  for (const f of ['ownerId', 'owner_id', 'owner', 'userId']) {
    const c = await api('bob POST ' + f, bt2, 'POST', '/v1/projects', { name: 'bob-owner-field', [f]: aSub });
    const q = await api('bob PATCH ' + f, bt2, 'PATCH', '/v1/projects/' + P, { name: 'x', expectedVersion: 1, [f]: bSub });
    const s = await api('alice PATCH own ' + f, at, 'PATCH', '/v1/projects/' + P, { name: 'x', expectedVersion: 1, [f]: bSub });
    A.check(`body field ${f}: POST, PATCH (bob) and PATCH (alice) all return 400`, c.status === 400 && q.status === 400 && s.status === 400, { post: c.status, bobPatch: q.status, alicePatch: s.status });
  }
  const hx = { 'x-user-id': aSub };
  const hl = await api('list + X-User-Id', bt2, 'GET', '/v1/projects?limit=100', undefined, hx);
  const hg = await api('GET P + X-User-Id', bt2, 'GET', '/v1/projects/' + P, undefined, hx);
  const hp = await api('PATCH P + X-User-Id', bt2, 'PATCH', '/v1/projects/' + P, { name: 'hdr', expectedVersion: 1 }, hx);
  const hc = await api('POST + X-User-Id', bt2, 'POST', '/v1/projects', { name: 'bob-hdr-create' }, hx);
  A.check('X-User-Id is ignored: P absent, GET/PATCH denied', Array.isArray(hl.j) && !hl.j.some((x) => x.id === P) && hg.status === g.status && hp.status === g.status, { get: hg.status, patch: hp.status });
  const owner = hc.j?.id ? sql(DB, `SELECT owner_id FROM projects WHERE id='${hc.j.id}'`) : '';
  A.check("a project bob creates with X-User-Id: alice is owned by bob", hc.status === 201 && owner === bSub, { status: hc.status });
  const finalRow = sql(DB, `SELECT owner_id||'|'||name||'|'||version FROM projects WHERE id='${P}'`);
  A.check("P's row (owner, name, version) is unchanged after every attempt", finalRow === row0 && finalRow.startsWith(aSub), { unchanged: finalRow === row0 });
  const ctl = await alice.request.post(cap.url, { headers: hdrs, data: cap.body, maxRedirects: 0 });
  A.check('control: alice replaying the same captured action does rename (the replay was well-formed)', (await ctl.text()).includes('Project renamed'), { status: ctl.status() });
} catch (e) { A.check('script completed without exception', false, String(e.stack || e).slice(0, 400)); }
await alice.tracing.stop({ path: OUT + '/trace-alice.zip' }).catch(() => {});
await browser.close();
writeFileSync(OUT + '/transcript.json', JSON.stringify(log, null, 1));
A.finish();
