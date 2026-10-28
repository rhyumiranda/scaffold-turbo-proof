import { chromium, kcLogin } from '../scripts/lib.mjs';
const env = process.env, BASE = 'http://localhost:3103';
const browser = await chromium.launch();
for (const rt of ['//evil.example/x', 'https://evil.example/', '/\\evil.example', '/projects/%', 'javascript:alert(1)', '/%0d%0aX:1', '/projects?x=1']) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const seen = []; page.on('framenavigated', (f) => { if (f === page.mainFrame()) seen.push(f.url().slice(0, 100)); });
  await page.route('**://evil.example/**', (r) => r.fulfill({ status: 200, body: 'EVIL' }));
  await page.goto(BASE + '/auth/login?returnTo=' + encodeURIComponent(rt)).catch(() => {});
  try { await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForLoadState('load'); } catch (e) { seen.push('ERR ' + e.message.slice(0, 60)); }
  await page.waitForTimeout(500);
  const resp = await page.evaluate(() => document.body.innerText.slice(0, 60)).catch(() => '');
  console.log(JSON.stringify({ returnTo: rt, final: page.url().slice(0, 100), body: resp }));
  await ctx.close();
}
await browser.close();
