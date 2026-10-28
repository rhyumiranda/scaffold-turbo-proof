'use strict';
// AC-67: failed submissions keep input, link the error with aria-describedby, announce politely, and show pending only while in flight.
const L = require('./lib.cjs');
const { BASE, check, seen, login, run, path } = L;

run('AC-67', async () => {
  const d = L.evDir('AC-67');
  const browser = await L.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('dialog', (dialog) => dialog.accept());
  await login(page, 'alice', process.env.ALICE_PASSWORD);
  const at = await L.apiToken('alice', process.env.ALICE_PASSWORD);
  const state = (button) => page.evaluate((button) => {
    const i = document.querySelector('#project-name');
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(button));
    const ids = (i.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const live = document.querySelector('[aria-live="polite"]');
    const errEl = ids.map((x) => document.getElementById(x)).find(Boolean);
    return {
      value: i.value, ariaInvalid: i.getAttribute('aria-invalid'), describedBy: ids, describedText: ids.map((x) => document.getElementById(x)?.textContent ?? null),
      errorIsNextToField: !!errEl && (errEl.previousElementSibling === i || i.nextElementSibling === errEl || errEl.parentElement === i.parentElement),
      liveText: live?.textContent ?? null, buttonDisabled: b?.disabled, buttonText: b?.textContent, spinner: !!b?.querySelector('[aria-hidden="true"]'),
    };
  }, button);

  async function scenario(name, url, button, typed, before, expectFieldError) {
    await page.goto(url);
    await seen(page.getByRole('button', { name: button }));
    if (before) await before();
    await page.getByLabel('Project name').fill(typed);
    const s0 = await state(button);
    let release;
    let arrived;
    const held = new Promise((r) => (release = r));
    const got = new Promise((r) => (arrived = r));
    await page.route('**/projects**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      arrived();
      await held;
      return route.continue().catch(() => {});
    });
    await page.getByRole('button', { name: button }).click();
    await got;
    await page.waitForTimeout(150);
    const s1 = await state(button);
    release();
    await page.waitForTimeout(3000);
    await page.unroute('**/projects**');
    const s2 = await state(button);
    await page.screenshot({ path: path.join(d, name + '.png') });
    const detail = { before: s0, during: s1, after: s2 };
    check(`${name}: typed input remains`, s2.value === typed, JSON.stringify(s2.value.slice(0, 20)));
    check(`${name}: aria-invalid is true and aria-describedby points to non-empty error text next to the field`, s2.ariaInvalid === 'true' && s2.describedText.some((t) => t && t.length > 0) && s2.errorIsNextToField, detail.after);
    check(`${name}: a polite live region announces the failure`, (s2.liveText || '').length > 0, s2.liveText);
    check(`${name}: submit is enabled before, disabled with spinner during, enabled without spinner after`, s0.buttonDisabled === false && s1.buttonDisabled === true && s1.spinner && s2.buttonDisabled === false && !s2.spinner, { before: [s0.buttonDisabled, s0.spinner], during: [s1.buttonDisabled, s1.spinner], after: [s2.buttonDisabled, s2.spinner] });
    void expectFieldError;
  }

  await scenario('server-validation-whitespace', BASE + '/projects', 'Create project', '   ');
  await scenario('server-validation-101-chars', BASE + '/projects', 'Create project', 'x'.repeat(101));
  const p = await L.apiCreate(at, 'AC67 conflict ' + Date.now());
  await scenario('conflict-409', BASE + '/projects/' + p.id, 'Save name', 'AC67 typed during conflict', async () => {
    check('competing update accepted', (await L.apiPatch(at, p.id, p.name + ' x', 1)) === 200);
  });
  await scenario('api-outage-create', BASE + '/projects', 'Create project', 'AC67 typed during outage', async () => { await L.toxi(false); });
  await L.toxi(true);
  const p2 = await L.apiCreate(at, 'AC67 outage rename ' + Date.now());
  await scenario('api-outage-rename', BASE + '/projects/' + p2.id, 'Save name', 'AC67 rename during outage', async () => { await L.toxi(false); });
  await L.toxi(true);
});
