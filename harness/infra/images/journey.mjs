// Container journey in a real Chromium: sign in at Keycloak (PKCE), create a project, reload, optionally rename.
// Env: WS (workspace root, for @playwright/test), BASE, OUT, NAME, KC_USER, KC_PASS, RENAME (non-empty = also rename).
// Writes result.json (pass, steps, authorization request facts, 5xx responses) and screenshots to OUT. No trace or
// video is kept, so no password lands in the evidence.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const req = createRequire(process.env.WS + '/apps/web/package.json');
const { chromium } = req('@playwright/test');
const { BASE, OUT, NAME, KC_USER = 'alice', KC_PASS } = process.env;
mkdirSync(OUT, { recursive: true });
if (!KC_PASS) throw new Error('KC_PASS missing');
const r = { base: BASE, name: NAME, steps: [] };
const step = (s) => { r.steps.push(new Date().toISOString() + ' ' + s); console.log(s); };
const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
const statuses = [];
page.on('response', (res) => statuses.push({ s: res.status(), m: res.request().method(), u: res.url().replace(/(code|state|session_state|nonce|code_challenge|iss)=[^&]+/g, '$1=<r>') }));
try {
  await page.goto(BASE + '/projects');
  // Private pages redirect straight to Keycloak; older builds showed a "Sign in" link first.
  const signIn = page.getByRole('link', { name: 'Sign in', exact: true });
  await Promise.race([page.waitForURL(/\/protocol\/openid-connect\/auth/, { timeout: 30000 }), signIn.waitFor({ timeout: 30000 })]).catch(() => {});
  if (!/\/protocol\/openid-connect\/auth/.test(page.url())) await signIn.click();
  await page.waitForURL(/\/protocol\/openid-connect\/auth/, { timeout: 30000 });
  const u = new URL(page.url());
  r.authorizationRequest = {
    origin: u.origin, path: u.pathname,
    code_challenge_method: u.searchParams.get('code_challenge_method'),
    state: !!u.searchParams.get('state'), nonce: !!u.searchParams.get('nonce'), code_challenge: !!u.searchParams.get('code_challenge'),
    redirect_uri: u.searchParams.get('redirect_uri'),
  };
  step('redirected to Keycloak ' + u.origin + u.pathname);
  await page.screenshot({ path: OUT + '/01-keycloak.png' });
  await page.waitForSelector('#username', { timeout: 30000 });
  await page.fill('#username', KC_USER);
  await page.fill('#password', KC_PASS);
  await Promise.all([page.waitForURL(BASE + '/projects', { timeout: 30000 }), page.click('#kc-login')]);
  step('landed ' + page.url());
  await page.getByLabel('Project name').fill(NAME);
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('status').filter({ hasText: 'Project created.' }).waitFor({ timeout: 20000 });
  step('created ' + NAME);
  await page.reload();
  await page.getByRole('link', { name: NAME, exact: true }).waitFor({ timeout: 20000 });
  step('visible after reload');
  await page.screenshot({ path: OUT + '/02-created.png' });
  if (process.env.RENAME) {
    await page.getByRole('link', { name: NAME, exact: true }).click();
    await page.getByRole('heading', { name: NAME, exact: true }).waitFor({ timeout: 20000 });
    await page.getByLabel('Project name').fill(NAME + ' renamed');
    await page.getByRole('button', { name: 'Save name' }).click();
    await page.getByRole('status').filter({ hasText: 'Project renamed.' }).waitFor({ timeout: 20000 });
    await page.reload();
    await page.getByRole('heading', { name: NAME + ' renamed', exact: true }).waitFor({ timeout: 20000 });
    step('renamed and visible after reload');
    await page.goto(BASE + '/projects');
    await page.getByRole('link', { name: NAME + ' renamed', exact: true }).waitFor({ timeout: 20000 });
    step('list shows renamed');
  }
  const cookies = await context.cookies();
  r.cookies = cookies.map((c) => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }));
  r.documentCookie = await page.evaluate(() => document.cookie);
  r.pass = true;
} catch (e) {
  r.pass = false;
  r.error = String((e && e.stack) || e).slice(0, 2000);
  await page.screenshot({ path: OUT + '/error.png' }).catch(() => {});
} finally {
  r.appResponses5xx = statuses.filter((x) => x.s >= 500);
  await context.close();
  await browser.close();
  writeFileSync(OUT + '/network.json', JSON.stringify(statuses, null, 1));
  writeFileSync(OUT + '/result.json', JSON.stringify(r, null, 1));
  console.log(JSON.stringify({ pass: r.pass, error: r.error, auth: r.authorizationRequest, cookies: r.cookies, documentCookie: r.documentCookie, fivexx: r.appResponses5xx.length }));
  process.exit(r.pass ? 0 : 1);
}
