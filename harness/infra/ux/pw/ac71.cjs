'use strict';
// AC-71: specific titles, noindex on private pages, list state in the URL surviving Back/Forward/reload.
const L = require('./lib.cjs');
const { BASE, check, seen, login, run, path } = L;

run('AC-71', async () => {
  const d = L.evDir('AC-71');
  const browser = await L.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 600 } })).newPage();
  page.on('dialog', (dialog) => dialog.accept());
  const rows = [];
  const info = async (key, response, titleRe, { noindex = true } = {}) => {
    const title = await page.title();
    const metas = await page.$$eval('meta[name="robots"]', (m) => m.map((x) => x.content));
    const xr = response ? (await response.allHeaders())['x-robots-tag'] ?? null : null;
    const h1 = await page.locator('h1').first().textContent().catch(() => null);
    rows.push({ key, url: page.url().replace(BASE, ''), status: response ? response.status() : null, title, metaRobots: metas, xRobotsTag: xr, h1 });
    check(`${key}: specific title`, title.length > 0 && titleRe.test(title), JSON.stringify(title));
    if (noindex) check(`${key}: noindex (meta robots or X-Robots-Tag)`, metas.some((m) => /noindex/i.test(m)) || /noindex/i.test(xr || ''), `meta=${JSON.stringify(metas)} header=${xr}`);
    return title;
  };
  const at = await L.apiToken('alice', process.env.ALICE_PASSWORD);
  await L.ensureProjects(at, 60);
  const items = await L.apiList(at, '?limit=3');

  let r = await page.goto(BASE + '/projects');
  await seen(page.locator('h1'));
  check('unauthenticated /projects goes to sign-in (third-party page)', /\/realms\/acme\//.test(page.url()), page.url().split('?')[0]);
  await login(page, 'alice', process.env.ALICE_PASSWORD);
  const titles = {};
  r = await page.goto(BASE + '/');
  await seen(page.locator('h1'));
  titles.home = await info('/ (home, redirects to the list)', r, /Projects/);
  r = await page.goto(BASE + '/projects');
  await seen(page.getByRole('link', { name: 'Next page' }));
  titles.list1 = await info('/projects', r, /^Projects\b/);
  r = await page.goto(BASE + '/projects?page=2');
  await seen(page.getByText('Page 2'));
  titles.list2 = await info('/projects?page=2', r, /page 2/i);
  for (const [i, p] of items.slice(0, 2).entries()) {
    r = await page.goto(BASE + '/projects/' + p.id);
    await seen(page.getByRole('heading', { name: p.name }));
    const t = await info(`/projects/{id} #${i + 1}`, r, new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    titles['detail' + i] = t;
  }
  r = await page.goto(BASE + '/projects/00000000-0000-4000-8000-000000000000');
  await seen(page.locator('h1'));
  titles.notFound = await info('not-found (unknown project id)', r, /not found/i);
  r = await page.goto(BASE + '/projects?page=0');
  await seen(page.locator('h1'));
  await info('invalid page number (?page=0)', r, /not found/i);
  r = await page.goto(BASE + '/nope');
  await seen(page.locator('h1'));
  titles.route404 = await info('unknown route', r, /not found/i);
  await L.toxi(false);
  r = await page.goto(BASE + '/projects');
  await seen(page.locator('h1'));
  titles.outage = await info('/projects with the API down', r, /unavailable/i);
  await L.toxi(true);
  r = await page.goto(BASE + '/signed-out');
  await seen(page.locator('h1'));
  titles.signedOut = await info('/signed-out', r, /signed out/i);
  r = await page.goto(BASE + '/sign-in-problem');
  await seen(page.locator('h1'));
  titles.problem = await info('/sign-in-problem', r, /\S/);
  const distinct = ['list1', 'list2', 'detail0', 'detail1', 'notFound', 'route404', 'outage', 'signedOut', 'problem'];
  const values = distinct.map((k) => titles[k]);
  check('titles of distinct pages and states are unique', new Set(values).size === values.length, Object.fromEntries(distinct.map((k) => [k, titles[k]])));

  // URL state and scroll restoration.
  await page.goto(BASE + '/projects?page=2');
  await seen(page.getByText('Page 2'));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const target = page.locator('main li a').nth(20);
  const targetName = (await target.textContent()) || '';
  await target.scrollIntoViewIfNeeded();
  const y1 = await page.evaluate(() => scrollY);
  await target.click();
  check('a list item opens its detail page', await seen(page.getByRole('heading', { name: targetName })), page.url().replace(BASE, ''));
  await page.goBack();
  await seen(page.getByText('Page 2'));
  await page.waitForTimeout(800);
  const yb = await page.evaluate(() => scrollY);
  check('Back returns to ?page=2', /[?&]page=2\b/.test(page.url()), page.url().replace(BASE, ''));
  check('Back restores the scroll position', y1 > 0 && Math.abs(yb - y1) < 5, `before=${y1} after=${yb}`);
  await page.goForward();
  check('Forward returns to the detail page', await seen(page.getByRole('heading', { name: targetName })));
  await page.goBack();
  await page.waitForTimeout(800);
  await page.reload();
  check('reload keeps ?page=2 and shows page 2', /[?&]page=2\b/.test(page.url()) && (await seen(page.getByText('Page 2'), 5000)), page.url().replace(BASE, ''));
  await page.screenshot({ path: path.join(d, 'after-back-reload.png') });
  require('node:fs').writeFileSync(path.join(d, 'routes.json'), JSON.stringify(rows, null, 1));
});
