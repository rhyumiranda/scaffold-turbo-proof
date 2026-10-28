// AC-58: one user submit = one API write, whatever fault sits between web and API.
// Env: see rt.mjs plus API_LOG (path of the API stdout file) and DB_PROXY (Toxiproxy proxy name in front of PostgreSQL).
import { readFileSync } from 'node:fs';
import { chromium, login, token, toxic, untoxic, proxyEnabled, waitStatus, saveJson, sleep, WEB, API, OUT } from './rt.mjs';

const apiLines = (fromIso, toIso) =>
  readFileSync(process.env.API_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((o) => o && o.event === 'request.complete' && o.time >= fromIso && o.time <= toIso && String(o.route).startsWith('/v1/projects'));

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const out = [];
try {
  await login(page, 'alice');
  const tok = await token('alice');
  let actionPosts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().startsWith(WEB + '/projects')) actionPosts++;
  });
  const created = await (
    await fetch(`${API}/v1/projects`, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'AC58 target' }) })
  ).json();

  async function run(label, kind, fault, clear) {
    await page.goto(WEB + (kind === 'rename' ? '/projects/' + created.id : '/projects'));
    await page.waitForSelector('#project-name');
    const name = `AC58 ${label} ${Date.now()}`;
    await page.fill('#project-name', name);
    await fault();
    actionPosts = 0;
    const from = new Date().toISOString();
    const started = Date.now();
    await page.getByRole('button', { name: kind === 'rename' ? 'Save name' : 'Create project' }).click();
    await waitStatus(page, /renamed|created|did not confirm|changed|Too many|expired|not found/, 40000);
    const ms = Date.now() - started;
    const message = await page.textContent('form [role=status]');
    await page.screenshot({ path: `${OUT}/${label}.png` });
    await clear();
    await sleep(15000); // a delayed or retried write would reach the API in this window
    const lines = apiLines(from, new Date().toISOString());
    const writes = lines.filter((o) => o.method === (kind === 'rename' ? 'PATCH' : 'POST'));
    const record = { label, kind, ms, uiMessage: message, browserActionPosts: actionPosts, apiWriteCompletions: writes.length, apiWriteStatuses: writes.map((o) => o.status), apiAllProjectRequests: lines.map((o) => `${o.method} ${o.status}`) };
    console.log(JSON.stringify(record));
    out.push(record);
  }
  const latency = (name) => async () => { await toxic('api', name, 'latency', { latency: 10000 }); };
  const remove = (name) => async () => { await untoxic('api', name); };
  const dbDown = async () => { await proxyEnabled(process.env.DB_PROXY, false); };
  const dbUp = async () => { await proxyEnabled(process.env.DB_PROXY, true); await sleep(2000); };
  await run('rename-timeout-latency10s', 'rename', latency('l1'), remove('l1'));
  await run('rename-reset-peer', 'rename', async () => { await toxic('api', 'r1', 'reset_peer', { timeout: 300 }); }, remove('r1'));
  await run('rename-timeout-toxic', 'rename', async () => { await toxic('api', 't1', 'timeout', { timeout: 0 }); }, remove('t1'));
  await run('rename-api-503', 'rename', dbDown, dbUp);
  await run('create-timeout-latency10s', 'create', latency('l2'), remove('l2'));
  await run('create-reset-peer', 'create', async () => { await toxic('api', 'r2', 'reset_peer', { timeout: 300 }); }, remove('r2'));
  await run('create-api-503', 'create', dbDown, dbUp);

  // GET behaviour: one list page load while the API answers 503.
  await proxyEnabled(process.env.DB_PROXY, false);
  const from = new Date().toISOString();
  await page.goto(WEB + '/projects');
  await page.waitForSelector('h1');
  const h1 = await page.textContent('h1');
  await sleep(3000);
  const gets = apiLines(from, new Date().toISOString()).filter((o) => o.method === 'GET');
  await dbUp();
  const record = { label: 'list-page-load-api-503', kind: 'list', h1, apiGetCompletions: gets.length, apiGetStatuses: gets.map((o) => o.status) };
  console.log(JSON.stringify(record));
  out.push(record);
} finally {
  saveJson(`${OUT}/results.json`, out);
  await browser.close();
}
