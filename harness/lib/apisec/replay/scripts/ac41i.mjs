import { chromium, kcLogin } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const env = process.env, BASE = 'http://localhost:3103';
const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage();
await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
const cookie = (await ctx.cookies(BASE)).map((c) => c.name + '=' + c.value).join('; ');
await page.goto(BASE + '/projects'); const href = await page.locator('a[href^="/projects/"]').first().getAttribute('href');
await browser.close();
const rows = [];
const qs = ['page=-1', 'page=abc', 'page=0', 'page=99999999999999999999', 'page=1&page=2', 'page[]=1', 'limit=100000', 'limit=-1', 'offset=-1', 'cursor=x', 'q=%00', 'x=' + 'a'.repeat(9000), 'page=2&limit=1', 'pageSize=1e9', 'sort=__proto__', 'page=%ZZ', 'page=%F0%28%8C%28'];
for (const base of ['/projects', href, '/projects/00000000-0000-0000-0000-000000000000', '/projects/not-a-uuid', '/projects/%00', '/projects/' + 'a'.repeat(3000), '/']) for (const q of ['', ...qs]) for (const method of ['GET', 'HEAD']) {
  const r = await fetch(BASE + base + (q ? '?' + q : ''), { method, headers: { cookie }, redirect: 'manual' }).catch((e) => ({ status: 'err ' + e.message }));
  rows.push({ method, url: (base + (q ? '?' + q : '')).slice(0, 90), status: r.status });
}
const c = {}; for (const r of rows) c[r.status] = (c[r.status] || 0) + 1;
writeFileSync(process.env.OUT + '/web-authed-get-matrix.json', JSON.stringify(rows));
console.log(JSON.stringify(c)); console.log(rows.filter((r) => typeof r.status !== 'number' || r.status >= 500));
