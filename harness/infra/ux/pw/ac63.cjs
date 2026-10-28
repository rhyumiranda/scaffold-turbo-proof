'use strict';
// AC-63 (browser part): projects created after a real Keycloak sign-in survive a reload and an API process restart.
const L = require('./lib.cjs');
const { BASE, check, seen, login, run, path, fs } = L;

async function createViaUi(page, name) {
  await page.getByLabel('Project name').fill(name);
  const posted = page.waitForResponse((r) => r.request().method() === 'POST' && Boolean(r.request().headers()['next-action']), { timeout: 20000 });
  await page.getByRole('button', { name: 'Create project' }).click();
  await posted;
  return seen(page.getByRole('link', { name, exact: true }), 15000);
}
const pidOf = () => fs.readFileSync(path.join(process.env.WORK, 'ux', 'api.pid'), 'utf8').trim();

run('AC-63', async () => {
  const d = L.evDir('AC-63');
  const browser = await L.launch();
  const page = await (await browser.newContext()).newPage();
  await login(page, 'alice', process.env.ALICE_PASSWORD);
  check('signed in through the real Keycloak form and returned to the app', new URL(page.url()).origin === new URL(BASE).origin, page.url().split('?')[0]);
  const stamp = Date.now();
  const names = [`AC63 before restart A ${stamp}`, `AC63 before restart B ${stamp}`];
  for (const n of names) check(`created in the UI and listed: ${n}`, await createViaUi(page, n));
  await page.reload();
  for (const n of names) check(`listed after reload: ${n}`, await seen(page.getByRole('link', { name: n, exact: true })));
  await page.screenshot({ path: path.join(d, 'before-restart.png'), fullPage: true });
  const before = pidOf();
  console.log(L.ctl('api', 'restart'));
  const after = pidOf();
  check('API process was really restarted (new pid)', before !== after, `${before} -> ${after}`);
  await page.reload();
  for (const n of names) check(`still listed after API restart and reload: ${n}`, await seen(page.getByRole('link', { name: n, exact: true })));
  await page.screenshot({ path: path.join(d, 'after-api-restart.png'), fullPage: true });
});
