import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const CLONE = process.env.CLONE;
const req = createRequire(CLONE + '/apps/web/package.json');
export const { chromium } = req('@playwright/test');
export const { createClient } = req('@redis/client');
export const sha = (s) => createHash('sha256').update(s).digest('hex');
export const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
export async function kcLogin(page, user, pass) {
  await page.waitForSelector('#username', { timeout: 15000 });
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await Promise.all([page.waitForLoadState('load'), page.click('#kc-login')]);
}
export function attachRecorder(page, sink) {
  page.on('console', (m) => sink.console.push({ type: m.type(), text: m.text() }));
  page.on('request', (r) => sink.requests.push({ method: r.method(), url: r.url(), headers: r.headers() }));
  page.on('response', async (r) => {
    const entry = { status: r.status(), url: r.url(), method: r.request().method(), resourceType: r.request().resourceType(), headers: await r.allHeaders().catch(() => ({})) };
    try { const ct = entry.headers['content-type'] || ''; if (!/image|font|octet/.test(ct) && r.status() < 300) entry.body = await r.text(); } catch {}
    sink.responses.push(entry);
  });
}
