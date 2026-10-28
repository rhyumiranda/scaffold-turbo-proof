'use strict';
// AC-64: axe-core WCAG 2.0 to 2.2 A/AA on every route and state, at 375x812 and 1440x900.
const L = require('./lib.cjs');
const { BASE, check, seen, login, run, path, fs, AxeBuilder, TAGS } = L;

run('AC-64', async () => {
  const d = L.evDir('AC-64');
  const at = await L.apiToken('alice', process.env.ALICE_PASSWORD);
  const count = await L.ensureProjects(at, 60);
  check('alice owns at least 60 projects', count >= 60, String(count));
  const browser = await L.launch();
  for (const vp of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
    const tag = `${vp.width}x${vp.height}`;
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    const scan = async (state, reached, p = page) => {
      check(`${tag} ${state}: state reached`, reached, p.url().replace(BASE, ''));
      const r = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
      fs.writeFileSync(path.join(d, `axe-${tag}-${state}.json`), JSON.stringify({ url: p.url(), tags: TAGS, violations: r.violations, passes: r.passes.length, incomplete: r.incomplete.map((x) => x.id) }, null, 1));
      await p.screenshot({ path: path.join(d, `shot-${tag}-${state}.png`), fullPage: true });
      check(`${tag} ${state}: zero axe violations`, r.violations.length === 0, r.violations.map((v) => `${v.id}(${v.impact},${v.nodes.length})`).join(' ') || `${r.passes.length} rules passed`);
    };
    // Unauthenticated private pages redirect to the identity provider; record where they land.
    await page.goto(BASE + '/projects');
    await page.waitForLoadState('load');
    check(`${tag} unauthenticated /projects goes to sign-in`, /\/realms\/acme\//.test(page.url()), page.url().split('?')[0]);
    await login(page, 'alice', process.env.ALICE_PASSWORD);
    await page.goto(BASE + '/');
    await scan('home', await seen(page.getByRole('heading', { name: 'Projects', exact: true })) && new URL(page.url()).pathname === '/projects');
    await page.goto(BASE + '/projects');
    await scan('list-60', await seen(page.getByRole('link', { name: 'Next page' })));
    await page.getByRole('button', { name: 'Create project' }).click();
    await scan('create-errors', await seen(page.getByText('Enter a project name.')));
    const p = await L.apiCreate(at, 'AC64 detail ' + Date.now());
    await page.goto(BASE + '/projects/' + p.id);
    await scan('detail', await seen(page.getByRole('heading', { name: p.name })));
    check(`${tag} competing update accepted`, (await L.apiPatch(at, p.id, p.name + ' competing', 1)) === 200);
    await page.getByLabel('Project name').fill('AC64 my edit');
    await page.getByRole('button', { name: 'Save name' }).click();
    await scan('conflict', await seen(page.getByRole('status').filter({ hasText: 'This project changed' })));
    await page.goto(BASE + '/projects/00000000-0000-4000-8000-000000000000');
    await scan('not-found', await seen(page.getByRole('heading', { name: 'Project not found' })));
    await L.toxi(false);
    await page.goto(BASE + '/projects');
    await scan('outage', await seen(page.getByRole('heading', { name: 'Projects unavailable' })));
    await L.toxi(true);
    // Empty list: bob has never created anything.
    const bctx = await browser.newContext({ viewport: vp });
    const bpage = await bctx.newPage();
    await login(bpage, 'bob', process.env.BOB_PASSWORD);
    await scan('list-empty', await seen(bpage.getByText('No projects yet')), bpage);
    await bctx.close();
    // Signed out.
    await page.goto(BASE + '/projects');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/signed-out/);
    await scan('signed-out', await seen(page.getByRole('heading', { name: 'Signed out' })));
    // Extra routes.
    await page.goto(BASE + '/sign-in-problem');
    await scan('extra-sign-in-problem', await seen(page.locator('h1')));
    await page.goto(BASE + '/no-such-route');
    await scan('extra-route-not-found', await seen(page.getByRole('heading', { name: 'Page not found' })));
    await ctx.close();
  }
});
