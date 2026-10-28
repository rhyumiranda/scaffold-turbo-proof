// AC-50: double-click and double-Enter on create produce exactly one record, also with 2 s latency web -> API.
// Env: see rt.mjs. Toxiproxy proxy "api" sits between the web app and the API.
import { chromium, login, apiCount, token, toxic, untoxic, waitStatus, saveJson, sleep, now, WEB, OUT } from './rt.mjs';

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const results = [];
try {
  await login(page, 'bob');
  await context.tracing.start({ screenshots: true, snapshots: true }); // started after sign-in: no password in the trace
  const tok = await token('bob');
  const posts = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().startsWith(WEB + '/projects')) posts.push(now());
  });
  const attempt = async (label, how) => {
    await page.goto(WEB + '/projects');
    await page.waitForSelector('#project-name');
    const before = await apiCount(tok);
    const name = label + '-' + Date.now();
    await page.fill('#project-name', name);
    posts.length = 0;
    const started = Date.now();
    if (how === 'dblclick') await page.getByRole('button', { name: 'Create project' }).dblclick();
    else {
      await page.focus('#project-name');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }
    await waitStatus(page, /Project created|did not confirm|Too many|expired/, 40000);
    await sleep(3000); // let any second submission reach the API
    const message = await page.textContent('form [role=status]');
    const after = await apiCount(tok);
    await page.screenshot({ path: `${OUT}/${label}.png` });
    const record = { label, how, before, after, delta: after - before, ms: Date.now() - started, browserPostsToWeb: posts.length, statusText: message, at: now() };
    console.log(JSON.stringify(record));
    results.push(record);
  };
  await attempt('dblclick-nolatency', 'dblclick');
  await attempt('enter2x-nolatency', 'enter');
  console.log('toxic add', await toxic('api', 'lat2s', 'latency', { latency: 2000, jitter: 0 }));
  try {
    await attempt('dblclick-2slatency', 'dblclick');
    await attempt('enter2x-2slatency', 'enter');
  } finally {
    await untoxic('api', 'lat2s');
  }
  await context.tracing.stop({ path: `${OUT}/trace.zip` });
} finally {
  saveJson(`${OUT}/results.json`, results);
  await context.close();
  await browser.close();
}
