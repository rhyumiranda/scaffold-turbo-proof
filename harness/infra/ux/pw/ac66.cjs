'use strict';
// AC-66: empty, API down (retry works once the API returns), unknown id, another user's id, slow load.
const L = require('./lib.cjs');
const { BASE, check, seen, login, run, path } = L;

run('AC-66', async () => {
  const d = L.evDir('AC-66');
  const shot = (p, n) => p.screenshot({ path: path.join(d, n + '.png'), fullPage: true });
  const browser = await L.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('dialog', (dialog) => dialog.accept());
  const backToList = async (p, linkName) => {
    const link = p.getByRole('link', { name: linkName });
    if (!(await seen(link))) return false;
    await link.click();
    return seen(p.getByRole('heading', { name: 'Projects', exact: true }));
  };

  // Empty list (bob has no projects): message plus a create action that works.
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const b = await bctx.newPage();
  await login(b, 'bob', process.env.BOB_PASSWORD);
  check('empty list shows a message', await seen(b.getByText('No projects yet')));
  await shot(b, 'empty');
  const emptyName = 'Bob first ' + Date.now();
  await b.getByLabel('Project name').fill(emptyName);
  await b.getByRole('button', { name: 'Create project' }).click();
  check('create action from the empty state works', await seen(b.getByRole('status').filter({ hasText: 'Project created.' })));
  await b.reload();
  check('the project created from the empty state is listed', await seen(b.getByRole('link', { name: emptyName, exact: true })));

  // Another user's id looks exactly like an unknown id and leaks nothing.
  const at = await L.apiToken('alice', process.env.ALICE_PASSWORD);
  const ap = await L.apiCreate(at, 'Alice secret AC66 ' + Date.now());
  await b.goto(BASE + '/projects/' + ap.id);
  check("another user's id shows not-found", await seen(b.getByRole('heading', { name: 'Project not found' })));
  check("another user's project name is nowhere in the DOM", !(await b.content()).includes(ap.name));
  await shot(b, 'forbidden-other-user');
  check('not-found has a working link back to the list (other user id)', await backToList(b, 'Return to projects'));

  // Unknown id.
  await login(page, 'alice', process.env.ALICE_PASSWORD);
  await page.goto(BASE + '/projects/11111111-1111-4111-8111-111111111111');
  check('unknown id shows not-found', await seen(page.getByRole('heading', { name: 'Project not found' })));
  await shot(page, 'not-found');
  check('not-found has a working link back to the list (unknown id)', await backToList(page, 'Return to projects'));

  // API down, then back: the retry button works once the API returns.
  await L.toxi(false);
  await page.goto(BASE + '/projects');
  check('API down shows an error state with Try again', await seen(page.getByRole('heading', { name: 'Projects unavailable' })) && (await page.getByRole('button', { name: 'Try again' }).count()) > 0);
  await shot(page, 'api-down');
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.waitForTimeout(1500);
  check('Try again while the API is still down keeps the error and the button', (await page.getByRole('heading', { name: 'Projects unavailable' }).count()) > 0 && (await page.getByRole('button', { name: 'Try again' }).count()) > 0);
  await L.toxi(true);
  let recovered = false;
  for (let i = 0; i < 3 && !recovered; i++) {
    const retry = page.getByRole('button', { name: 'Try again' });
    if (await retry.count()) await retry.click();
    recovered = await seen(page.getByRole('heading', { name: 'Projects', exact: true }), 8000);
  }
  check('Try again recovers once the API is back', recovered);
  await shot(page, 'api-down-after-try-again');

  // Detail page with the API down.
  await L.toxi(false);
  await page.goto(BASE + '/projects/' + ap.id);
  check('detail page: API down shows the error state', await seen(page.getByRole('heading', { name: 'Projects unavailable' })) || await seen(page.getByText(/unavailable/i)));
  await L.toxi(true);
  let detailRecovered = false;
  for (let i = 0; i < 3 && !detailRecovered; i++) {
    const retry = page.getByRole('button', { name: 'Try again' });
    if (await retry.count()) await retry.click();
    detailRecovered = await seen(page.getByRole('heading', { name: ap.name }), 8000);
  }
  check('detail page: Try again recovers once the API is back', detailRecovered);

  // Slow load: Toxiproxy adds 2 s of latency between web and API.
  await L.latency(2000);
  const sctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: await ctx.storageState() });
  const s = await sctx.newPage();
  await s.addInitScript(L.clsInit);
  const t0 = Date.now();
  await s.goto(BASE + '/projects', { waitUntil: 'commit' });
  await s.waitForTimeout(Math.max(0, 500 - (Date.now() - t0)));
  await s.screenshot({ path: path.join(d, 'slow-load-at-500ms.png') });
  const loadingText = await s.locator('body').innerText();
  check('a loading message is visible at 500 ms', /loading/i.test(loadingText), JSON.stringify(loadingText.slice(0, 120)));
  const loaded = await seen(s.getByRole('button', { name: 'Create project' }), 20000);
  check('the page finishes loading under 2 s latency', loaded, `after ${Date.now() - t0} ms`);
  await s.waitForTimeout(500);
  await s.screenshot({ path: path.join(d, 'slow-load-loaded.png') });
  const cls = await s.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts }));
  check('cumulative layout shift from loading to loaded is at most 0.1 (full load)', cls.cls <= 0.1, cls);
  // Client-side navigation under the same latency.
  await s.goto(BASE + '/projects/' + ap.id, { waitUntil: 'commit' });
  await seen(s.getByRole('heading', { name: ap.name }), 20000);
  await s.evaluate(() => { window.__cls = 0; window.__shifts = []; });
  await s.getByRole('link', { name: 'All projects' }).click();
  await s.waitForTimeout(500);
  await s.screenshot({ path: path.join(d, 'slow-clientnav-at-500ms.png') });
  const navText = await s.locator('body').innerText();
  check('a loading message is visible at 500 ms on client-side navigation', /loading/i.test(navText), JSON.stringify(navText.slice(0, 120)));
  await seen(s.getByRole('button', { name: 'Create project' }), 20000);
  await s.waitForTimeout(500);
  const cls2 = await s.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts }));
  check('cumulative layout shift on client-side navigation is at most 0.1', cls2.cls <= 0.1, cls2);
  await L.latency(0);
});
