'use strict';
// AC-65: keyboard-only journey (Tab, Shift+Tab, Enter, Escape, typing) with a visible focus indicator at every stop.
const L = require('./lib.cjs');
const { BASE, check, seen, run, path } = L;

run('AC-65', async () => {
  const d = L.evDir('AC-65');
  const log = [];
  let n = 0;
  const bad = [];
  const browser = await L.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('dialog', (dialog) => { log.push(`dialog ${dialog.type()}: ${dialog.message()} -> accept`); dialog.accept(); });
  const focusRaw = () => page.evaluate(() => {
    const e = document.activeElement;
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return { tag: e.tagName, id: e.id, text: (e.innerText || e.value || e.getAttribute('aria-label') || '').slice(0, 60), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow, inViewport: r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.height > 0 };
  });
  const focusInfo = async () => {
    for (let a = 0; a < 5; a++) {
      try { return await focusRaw(); } catch { await page.waitForLoadState('load').catch(() => {}); await page.waitForTimeout(300); }
    }
    return { tag: 'NAVIGATING' };
  };
  const key = async (k, label = '') => {
    await page.keyboard.press(k);
    await page.waitForTimeout(150);
    const f = await focusInfo();
    n++;
    const skipped = ['BODY', 'NAVIGATING'].includes(f.tag);
    const visible = skipped ? null : (f.outlineStyle !== 'none' && parseFloat(f.outlineWidth) > 0) || f.boxShadow !== 'none';
    log.push(`${n} key=${k} ${label} -> ${JSON.stringify(f)} visibleIndicator=${visible}`);
    if (visible === false || (!skipped && !f.inViewport)) bad.push(`${n}:${f.tag}#${f.id}`);
    if (k === 'Tab' || k === 'Shift+Tab') await page.screenshot({ path: path.join(d, `step-${String(n).padStart(2, '0')}.png`) });
    return f;
  };
  const tabTo = async (pred, max = 20) => {
    for (let i = 0; i < max; i++) { const f = await key('Tab'); if (pred(f)) return f; }
    throw new Error('target not reached by Tab');
  };
  const typeName = async (name) => {
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(name);
  };

  // Sign in with the keyboard only.
  await page.goto(BASE + '/auth/login');
  await page.waitForURL(/\/realms\/acme\//);
  await page.waitForSelector('#username');
  let f = await focusInfo();
  if (f.id !== 'username') f = await tabTo((x) => x.id === 'username', 6);
  await page.keyboard.type('alice');
  await key('Tab', 'to password');
  await page.keyboard.type(process.env.ALICE_PASSWORD);
  await key('Enter', 'submit Keycloak login');
  await page.waitForURL((u) => u.origin === new URL(BASE).origin && !u.pathname.startsWith('/auth'), { timeout: 30000 });
  check('keyboard sign-in reached the app', new URL(page.url()).pathname.startsWith('/projects'), page.url().replace(BASE, ''));

  // Skip link: first Tab on a fresh page load focuses it; Enter moves focus into main.
  await page.goto(BASE + '/projects');
  await seen(page.getByRole('heading', { name: 'Projects', exact: true }));
  f = await key('Tab', 'first tab');
  check('skip link is the first focus stop', /skip to content/i.test(f.text), f.text);
  await key('Enter', 'activate skip link');
  const hash = await page.evaluate(() => location.hash);
  f = await key('Tab', 'tab after skip link');
  const inMain = await page.evaluate(() => document.querySelector('main').contains(document.activeElement));
  check('skip link reaches main content (hash #content, next Tab inside main)', hash === '#content' && inMain, `hash=${hash} inMain=${inMain}`);

  // Validation error: empty submit moves focus to the first invalid field.
  if (f.id !== 'project-name') await tabTo((x) => x.id === 'project-name');
  await key('Enter', 'submit empty form');
  check('validation error shown', await seen(page.getByText('Enter a project name.')));
  f = await focusInfo();
  check('focus moved to the first invalid field', f.id === 'project-name', `focus on ${f.tag}#${f.id}`);

  // Recover: type a valid name, create, open, rename.
  const name = 'Keyboard project ' + Date.now();
  await page.keyboard.type(name);
  await key('Enter', 'submit create');
  check('created by keyboard', await seen(page.getByRole('status').filter({ hasText: 'Project created.' })));
  await tabTo((x) => /open created project/i.test(x.text));
  await key('Enter', 'open created project');
  check('opened the detail page by keyboard', await seen(page.getByRole('heading', { name, exact: true })), page.url().replace(BASE, ''));
  await tabTo((x) => x.id === 'project-name');
  await typeName(name + ' renamed');
  await key('Enter', 'submit rename');
  check('renamed by keyboard', await seen(page.getByRole('status').filter({ hasText: 'Project renamed.' })));

  // Conflict: another client updates the project, then the stale form is saved.
  const at = await L.apiToken('alice', process.env.ALICE_PASSWORD);
  const id = page.url().split('/').pop();
  const patch = await L.apiPatch(at, id, name + ' competing', 2);
  check('competing update accepted by the API', patch === 200, String(patch));
  await typeName('Keyboard conflict edit');
  await key('Enter', 'submit stale rename');
  check('conflict announced', await seen(page.getByRole('status').filter({ hasText: 'This project changed' })));
  check('typed input kept after conflict', (await page.inputValue('#project-name')) === 'Keyboard conflict edit');
  // The page tells the user to reload. Headless Chromium does not run the browser-chrome F5 shortcut, so page.reload() stands in for it.
  await page.reload();
  await page.waitForLoadState('load');
  check('after reload the competing name is shown', await seen(page.getByRole('heading', { name: name + ' competing', exact: true })));
  await tabTo((x) => x.id === 'project-name', 20);
  await typeName('Keyboard conflict resolved');
  await key('Enter', 'resubmit after conflict');
  check('recovered from the conflict by keyboard', await seen(page.getByRole('status').filter({ hasText: 'Project renamed.' })));

  // Reverse sweep and Escape.
  for (let i = 0; i < 5; i++) await key('Shift+Tab', 'reverse');
  await key('Escape', 'escape');
  check('every focus stop had a visible indicator and was on screen', bad.length === 0 && n >= 20, `stops=${n} bad=${JSON.stringify(bad)}`);
  require('node:fs').writeFileSync(path.join(d, 'keyboard-run.log'), log.join('\n').replaceAll(process.env.ALICE_PASSWORD, '***'));
  await page.screenshot({ path: path.join(d, 'final.png') });
});
