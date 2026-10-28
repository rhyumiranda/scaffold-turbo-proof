'use strict';
// Seeds exactly 20 projects for user load1, signs in through Keycloak, and writes the session cookie header to a mode-600 file
// (outside the evidence folder) for Lighthouse's --extra-headers.
const L = require('./lib.cjs');
const { BASE, check, login, run, fs } = L;

run('AC-70', async () => {
  const at = await L.apiToken('load1', process.env.ALICE_PASSWORD);
  const have = (await L.apiList(at, '?limit=100')).length;
  for (let i = have; i < 20; i++) await L.apiCreate(at, 'Lighthouse project ' + String(i + 1).padStart(2, '0'));
  const total = (await L.apiList(at, '?limit=100')).length;
  check('load1 owns 20 projects', total === 20, String(total));
  const browser = await L.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'load1', process.env.ALICE_PASSWORD);
  const cookie = (await ctx.cookies()).find((x) => x.name === 'app_session' || x.name === '__Host-app_session');
  check('session cookie obtained', Boolean(cookie));
  fs.writeFileSync(process.env.LH_HEADERS, JSON.stringify({ Cookie: `${cookie.name}=${cookie.value}` }), { mode: 0o600 });
  await page.goto(BASE + '/projects');
  check('authenticated /projects lists the 20 items', (await page.locator('main li').count()) === 20);
});
