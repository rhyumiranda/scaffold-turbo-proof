// AC-55 web part: web -> API stall (proxy "api" latency 60 s) shows the error UI within the 4 s web deadline + 1 s, input kept.
import { chromium, login, toxic, untoxic, waitStatus, saveJson, WEB, OUT } from './rt.mjs';
const browser = await chromium.launch(); const page = await (await browser.newContext()).newPage(); const out = {};
try {
  await login(page, 'alice');
  await page.goto(WEB + '/projects'); await page.waitForSelector('#project-name');
  const typed = 'AC55 web stall ' + Date.now(); await page.fill('#project-name', typed);
  await toxic('api', 'stall60', 'latency', { latency: 60000 });
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Create project' }).click();
  await waitStatus(page, /did not confirm|unavailable|Too many|expired/, 70000);
  out.create = { ms: Date.now() - t0, status: await page.textContent('form [role=status]'), kept: (await page.inputValue('#project-name')) === typed };
  await page.screenshot({ path: OUT + '/create-stall.png' });
  await untoxic('api', 'stall60');
  await toxic('api', 'stall60b', 'latency', { latency: 60000 });
  const t1 = Date.now();
  await page.goto(WEB + '/projects', { waitUntil: 'commit', timeout: 70000 });
  await page.getByRole('heading', { name: 'Projects unavailable' }).waitFor({ timeout: 70000 });
  out.list = { ms: Date.now() - t1 };
  await page.screenshot({ path: OUT + '/list-stall.png' });
} finally { await untoxic('api', 'stall60').catch(() => {}); await untoxic('api', 'stall60b').catch(() => {}); saveJson(OUT + '/web-stall.json', out); await browser.close(); }
