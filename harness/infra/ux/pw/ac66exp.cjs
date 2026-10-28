'use strict';
// AC-66 expired session. Runs against the web instance whose sessions last 60 s (AUTH_SESSION_SECONDS=60).
//   node ac66exp.cjs sso   : Keycloak still has a login session -> automatic return to the original page
//   node ac66exp.cjs nosso : Keycloak cookies cleared -> login form, then return to the original page
//   node ac66exp.cjs form  : session expires while a form is open -> message, sign-in link, input kept, save again
const L = require('./lib.cjs');
const { BASE_SHORT: BASE, check, seen, login, run, path } = L;
const mode = process.argv[2];
const KC_COOKIES = /KEYCLOAK|KC_|AUTH_SESSION_ID/i;
const sameOriginApp = (u) => u.origin === new URL(BASE).origin && !u.pathname.startsWith('/auth');

async function landAfterSignIn(page, target) {
  await page.goto(target, { waitUntil: 'load' }).catch(() => {});
  await page.waitForTimeout(500);
  const atForm = /localhost:8080/.test(page.url()) && (await page.locator('#username').count()) > 0;
  if (atForm) {
    await page.fill('#username', 'alice');
    await page.fill('#password', process.env.ALICE_PASSWORD);
    await page.click('#kc-login');
  }
  await page.waitForURL(sameOriginApp, { timeout: 30000 });
  await page.waitForTimeout(800);
  return atForm;
}

run('AC-66', async () => {
  const d = L.evDir('AC-66');
  const browser = await L.launch();
  const at = await L.apiToken('alice', process.env.ALICE_PASSWORD);
  if (mode === 'sso' || mode === 'nosso') {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const ap = await L.apiCreate(at, `Alice expiry AC66 ${mode} ${Date.now()}`);
    await login(page, 'alice', process.env.ALICE_PASSWORD, BASE);
    const targets = [BASE + '/projects/' + ap.id, BASE + '/projects?page=2'];
    await page.goto(targets[0]);
    check('detail visible before the session expires', await seen(page.getByRole('heading', { name: ap.name })));
    await page.waitForTimeout(65000);
    for (const [i, target] of targets.entries()) {
      if (i === 1) await page.waitForTimeout(65000); // the new session also expires
      if (mode === 'nosso') {
        const all = await ctx.cookies();
        await ctx.clearCookies();
        await ctx.addCookies(all.filter((c) => !KC_COOKIES.test(c.name)));
      }
      const atForm = await landAfterSignIn(page, target);
      await page.screenshot({ path: path.join(d, `expired-${mode}-${i}-landed.png`) });
      check(`${mode}: expired session sent the user to sign-in${mode === 'nosso' ? ' (login form shown)' : ''}`, mode === 'nosso' ? atForm : true, `form=${atForm}`);
      check(`${mode}: after sign-in the user is back on the original page ${target.replace(BASE, '')}`, page.url() === target, page.url().replace(BASE, ''));
    }
  } else if (mode === 'form') {
    const seed = await L.apiCreate(at, 'AC66 rename seed ' + Date.now());
    const seed2 = await L.apiCreate(at, 'AC66 rename seed nosso ' + Date.now());
    const cases = [
      { id: 'create-sso', kind: 'create', url: '/projects', sso: true },
      { id: 'create-nosso', kind: 'create', url: '/projects', sso: false },
      { id: 'rename-sso', kind: 'rename', url: '/projects/' + seed.id, sso: true },
      { id: 'rename-nosso', kind: 'rename', url: '/projects/' + seed2.id, sso: false },
    ];
    for (const c of cases) {
      c.ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      c.page = await c.ctx.newPage();
      await login(c.page, 'alice', process.env.ALICE_PASSWORD, BASE);
      await c.page.goto(BASE + c.url);
      await seen(c.page.getByLabel('Project name'));
      c.btn = c.kind === 'create' ? 'Create project' : 'Save name';
      c.typed = `AC66 ${c.id} ${Date.now()}`;
    }
    await new Promise((r) => setTimeout(r, 70000));
    for (const c of cases) {
      const p = c.page;
      await p.getByLabel('Project name').fill(c.typed);
      await p.getByRole('button', { name: c.btn }).click();
      const link = p.getByRole('link', { name: /sign in again/i });
      const shown = await seen(link, 10000);
      check(`${c.id}: expired-session message and a sign-in link are shown`, shown && (await p.getByRole('status').innerText()).trim().length > 0);
      check(`${c.id}: typed input kept`, (await p.getByLabel('Project name').inputValue()) === c.typed);
      await p.screenshot({ path: path.join(d, `form-expired-${c.id}-1-message.png`) });
      if (!shown) { await c.ctx.close(); continue; }
      if (!c.sso) {
        const all = await c.ctx.cookies();
        await c.ctx.clearCookies();
        await c.ctx.addCookies(all.filter((x) => !KC_COOKIES.test(x.name)));
      }
      const [pop] = await Promise.all([c.ctx.waitForEvent('page', { timeout: 15000 }), link.click()]);
      await pop.waitForLoadState('load');
      if (/localhost:8080/.test(pop.url()) && (await pop.locator('#username').count())) {
        await pop.fill('#username', 'alice');
        await pop.fill('#password', process.env.ALICE_PASSWORD);
        await pop.click('#kc-login');
      }
      await pop.waitForURL(sameOriginApp, { timeout: 30000 });
      await pop.close();
      await p.bringToFront();
      check(`${c.id}: input still kept after signing in in the other tab`, (await p.getByLabel('Project name').inputValue()) === c.typed);
      await p.getByRole('button', { name: c.btn }).click();
      const ok = c.kind === 'create' ? 'Project created.' : 'Project renamed.';
      check(`${c.id}: saving again succeeds`, await seen(p.getByRole('status').filter({ hasText: ok }), 10000));
      await p.screenshot({ path: path.join(d, `form-expired-${c.id}-3-saved.png`) });
      const list = await L.apiList(at, '?limit=100');
      check(`${c.id}: the saved value is persisted by the API`, list.some((x) => x.name === c.typed));
      await c.ctx.close();
    }
  } else throw new Error('mode must be sso, nosso or form');
});
