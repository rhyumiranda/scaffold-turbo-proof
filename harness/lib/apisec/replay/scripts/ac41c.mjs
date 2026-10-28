import { chromium, kcLogin } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const env = process.env, BASE = 'http://localhost:3103', out = env.OUT;
const browser = await chromium.launch(); const ctx = await browser.newContext(); const page = await ctx.newPage();
await page.goto(BASE + '/auth/login'); await kcLogin(page, 'alice', env.ALICE_PASSWORD); await page.waitForURL(BASE + '/projects');
let id; page.on('request', (rq) => { if (rq.method() === 'POST' && rq.headers()['next-action'] && !id) id = rq.headers()['next-action']; });
await page.getByLabel('Project name').fill('ac41c'); await page.getByRole('button', { name: 'Create project' }).click();
await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor();
await browser.close();
const rows = [];
for (const b of ['null', '"str"', '5', 'true', '1.5', '', '[', '[[["x"]]]', '["$K1"]', '["$@1"]', '["$F1"]', '{"0":1,"length":2}', '[{"__proto__":{"a":1}}]']) {
  const r = await fetch(BASE + '/projects', { method: 'POST', headers: { 'next-action': id, 'content-type': 'text/plain;charset=UTF-8', origin: BASE, 'sec-fetch-site': 'same-origin' }, body: b });
  const t = await r.text(); rows.push({ body: b, status: r.status, excerpt: t.slice(0, 110).replace(/\n/g, ' ') }); console.log(JSON.stringify(rows.at(-1)));
}
writeFileSync(out + '/results-c.json', JSON.stringify(rows, null, 1));
