// Observability journey: real Keycloak sign-in, create (unique sentinel name), open, rename, sign out.
// Writes journey.json to OUT and the real credentials it saw to NEEDLES_FILE (mode 600, outside the evidence).
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, redisModule, saveJson, now, WEB, OUT } from './rt.mjs';

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const needles = {};
const result = { start: now(), createPosts: [], renamePosts: [], signOutPosts: [] };
let bucket = null;
page.on('request', (r) => {
  if (r.url().startsWith(WEB + '/auth/callback')) { const code = new URL(r.url()).searchParams.get('code'); if (code) needles['oidc-code'] = code; }
});
page.on('response', (r) => {
  if (r.request().method() === 'POST' && r.url().startsWith(WEB) && bucket) bucket.push({ url: r.url(), status: r.status(), xRequestId: r.headers()['x-request-id'] });
});
try {
  await page.goto(WEB + '/projects');
  await page.waitForURL(/realms\/acme/, { timeout: 30000 });
  await page.fill('#username', 'alice'); await page.fill('#password', process.env.KC_USER_PASSWORD); await page.click('#kc-login');
  await page.waitForURL(/\/projects/, { timeout: 30000 });
  const name = 'SENTINEL-AC61-' + Date.now();
  result.projectName = name;
  await page.fill('#project-name', name);
  bucket = result.createPosts;
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForFunction(() => /Project created/.test(document.querySelector('form [role=status]')?.textContent || ''), null, { timeout: 30000 });
  await page.click('text=Open created project');
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.fill('#project-name', name + ' renamed');
  bucket = result.renamePosts;
  await page.getByRole('button', { name: 'Save name' }).click();
  await page.waitForFunction(() => /renamed/.test(document.querySelector('form [role=status]')?.textContent || ''), null, { timeout: 30000 });
  // Real credentials, read from the server-side session in Redis (read-only), for the leak search.
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === 'app_session' || c.name === '__Host-app_session');
  needles['session-cookie-value'] = session.value;
  result.sessionCookieName = session.name; result.httpOnly = session.httpOnly;
  writeFileSync(process.env.COOKIE_FILE, session.name + '=' + session.value, { mode: 0o600 });
  const { createClient } = redisModule();
  const redis = createClient({ url: 'redis://127.0.0.1:6379' });
  await redis.connect();
  const raw = await redis.get(`${process.env.WEB_NS}:session:${createHash('sha256').update(session.value).digest('hex')}`);
  await redis.quit();
  const s = JSON.parse(raw);
  for (const [k, v] of Object.entries({ 'access-token': s.accessToken, 'refresh-token': s.refreshToken, 'id-token': s.idToken })) {
    if (typeof v === 'string' && v) { needles[k] = v; if (v.split('.').length === 3) needles[k + '-signature'] = v.split('.')[2]; }
  }
  result.sessionKeys = Object.keys(s);
  await page.goto(WEB + '/projects');
  bucket = result.signOutPosts;
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForLoadState('networkidle');
  result.finalUrl = page.url();
} finally {
  result.end = now();
  saveJson(OUT + '/journey.json', result);
  writeFileSync(process.env.NEEDLES_FILE, JSON.stringify(needles), { mode: 0o600 });
  await browser.close();
}
