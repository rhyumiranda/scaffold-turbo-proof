// AC-56: stop PostgreSQL, Redis, Keycloak (each 30 s) during a running journey; observe, then require recovery <= 15 s.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium, login, token, proxyEnabled, saveJson, sleep, now, STACK, WEB, API, OUT } from './rt.mjs';
const log = []; const note = (o) => { const r = { at: now(), ...o }; log.push(r); console.log(JSON.stringify(r)); };
const pid = (f) => Number(readFileSync(process.env.PID_DIR + '/' + f + '.pid', 'utf8'));
const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
async function journey(page, tag) {
  await page.goto(WEB + '/projects', { timeout: 10000 });
  if ((await page.textContent('h1', { timeout: 8000 })) !== 'Projects') throw new Error('h1 not Projects');
  const name = `AC56 ${tag} ${Date.now()}`;
  await page.fill('#project-name', name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForFunction(() => /Project created|did not confirm|Too many|expired/.test(document.querySelector('form [role=status]')?.textContent || ''), null, { timeout: 8000 });
  if (!/Project created/.test(await page.textContent('form [role=status]'))) throw new Error('create failed');
  await page.click('text=Open created project');
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 8000 });
  await page.fill('#project-name', name + ' renamed');
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.waitForFunction(() => /renamed|did not confirm|changed|expired/.test(document.querySelector('form [role=status]')?.textContent || ''), null, { timeout: 8000 });
  if (!/renamed/.test(await page.textContent('form [role=status]'))) throw new Error('rename failed');
}
async function until(fn, since, limit = 40000) {
  let tries = 0, last;
  while (Date.now() - since < limit) { tries++; try { await fn(); return { ok: true, tries, recoveredMs: Date.now() - since }; } catch (e) { last = String(e.message).split('\n')[0].slice(0, 160); await sleep(700); } }
  return { ok: false, tries, last };
}
async function observe(page, label) {
  const resp = await page.goto(WEB + '/projects', { timeout: 20000 }).catch((e) => ({ error: e.message }));
  await sleep(1500);
  const text = await page.evaluate(() => document.body.innerText);
  const retry = (await page.getByRole('button', { name: /try again/i }).count()) + (await page.getByRole('link', { name: /try/i }).count());
  await page.screenshot({ path: `${OUT}/${label}.png` });
  note({ label, status: resp?.status ? resp.status() : resp.error, url: page.url(), h1: await page.textContent('h1').catch(() => null), text: text.slice(0, 200), retryControls: retry, stack: STACK.test(text) });
}
const before = { api: pid('api-1'), web: pid('web-1') };
const browser = await chromium.launch(); const page = await (await browser.newContext()).newPage();
const bad = [];
page.on('response', async (r) => { if (r.status() >= 500 && r.url().startsWith(WEB)) { let b = ''; try { b = await r.text(); } catch {} bad.push({ url: r.url(), status: r.status(), stack: STACK.test(b) }); } });
const apiGet = async (tok) => { try { const r = await fetch(`${API}/v1/projects?limit=1`, { headers: { authorization: 'Bearer ' + tok }, signal: AbortSignal.timeout(15000) }); const b = await r.text(); return { status: r.status, stack: STACK.test(b) }; } catch (e) { return { status: 'ERR ' + e.name }; } };
try {
  await login(page, 'alice');
  await journey(page, 'baseline'); note({ label: 'baseline-journey', ok: true });
  const tok = await token('alice');
  for (const [name, container] of [['postgres', 'dro-pg'], ['redis', 'dro-redis']]) {
    execSync('docker stop ' + container); const down = Date.now(); note({ label: name + '-stopped' });
    await sleep(3000);
    note({ label: name + '-down-api', ...(await apiGet(tok)) });
    await observe(page, name + '-down');
    await sleep(Math.max(0, 30000 - (Date.now() - down)));
    execSync('docker start ' + container); const up = Date.now(); note({ label: name + '-started' });
    for (let i = 0; i < 6 && (Date.now() - up) < 15000; i++) { const b = page.getByRole('button', { name: /try again/i }); if (!(await b.count())) break; await b.click(); await sleep(1500); if ((await page.textContent('h1').catch(() => null)) === 'Projects') break; }
    note({ label: name + '-recovery', ...(await until(() => journey(page, 'after-' + name), up)) });
  }
  const tok2 = await token('alice');
  await proxyEnabled('kc', false); const kdown = Date.now(); note({ label: 'keycloak-stopped' });
  await sleep(2000);
  note({ label: 'keycloak-down-existing-token-api', ...(await apiGet(tok2)) });
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto(WEB + '/auth/login', { timeout: 25000 }).catch(() => {});
  await sleep(2000);
  const ftext = await fresh.evaluate(() => document.body?.innerText || '').catch(() => '');
  const fretry = (await fresh.getByRole('link', { name: /try/i }).count()) + (await fresh.getByRole('button', { name: /try/i }).count());
  await fresh.screenshot({ path: OUT + '/keycloak-down-fresh-login.png' });
  note({ label: 'keycloak-down-fresh-login', url: fresh.url(), text: ftext.slice(0, 200), retryControls: fretry, stack: STACK.test(ftext) });
  await sleep(Math.max(0, 25000 - (Date.now() - kdown)));
  note({ label: 'keycloak-down-existing-token-api-25s', ...(await apiGet(tok2)) });
  await sleep(Math.max(0, 30000 - (Date.now() - kdown)));
  await proxyEnabled('kc', true); const kup = Date.now(); note({ label: 'keycloak-started' });
  note({ label: 'keycloak-recovery', ...(await until(async () => {
    const c = await browser.newContext(); const p = await c.newPage();
    try { await login(p, 'alice'); await journey(p, 'after-keycloak'); } finally { await c.close(); }
  }, kup)) });
  const after = { api: pid('api-1'), web: pid('web-1') };
  note({ label: 'pids', before, after, unchanged: before.api === after.api && before.web === after.web, alive: alive(after.api) && alive(after.web) });
  note({ label: 'web-5xx', count: bad.length, withStack: bad.filter((b) => b.stack).length });
} finally {
  for (const c of ['dro-pg', 'dro-redis']) try { execSync('docker start ' + c); } catch {}
  await proxyEnabled('kc', true).catch(() => {});
  saveJson(OUT + '/results.json', log); await browser.close();
}
