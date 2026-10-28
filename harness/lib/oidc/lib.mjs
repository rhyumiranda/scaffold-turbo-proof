export * from '../apisec/lib.mjs';
import { reqWeb, env, sha, JWT } from '../apisec/lib.mjs';
export const { chromium } = reqWeb('@playwright/test');
export const { createClient } = reqWeb('@redis/client');
export async function kcLogin(page, user, pass) {
  await page.waitForSelector('#username', { timeout: 20000 });
  await page.fill('#username', user); await page.fill('#password', pass);
  await Promise.all([page.waitForLoadState('load'), page.click('#kc-login')]);
}
export function attachRecorder(page, sink) {
  page.on('console', (m) => sink.console.push({ type: m.type(), text: m.text() }));
  page.on('request', (r) => sink.requests.push({ method: r.method(), url: r.url(), headers: r.headers() }));
  page.on('response', async (r) => {
    const e = { status: r.status(), url: r.url(), method: r.request().method(), headers: await r.allHeaders().catch(() => ({})) };
    try { const ct = e.headers['content-type'] || ''; if (!/image|font|octet/.test(ct) && r.status() < 300) e.body = await r.text(); } catch {}
    sink.responses.push(e);
  });
}
export const redisSession = async (port, ns, cookieValue) => {
  const c = createClient({ url: `redis://127.0.0.1:${port}` }); await c.connect();
  const raw = await c.get(`${ns}:session:${sha(cookieValue)}`); await c.quit();
  return raw ? JSON.parse(raw) : null;
};
