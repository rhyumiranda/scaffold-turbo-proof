'use strict';
// AC-69: layouts at 375x812, 1280x800, 2560x1080 and 200% zoom at 1280; owner input rules; reduced motion.
const L = require('./lib.cjs');
const { BASE, API, check, login, run, path } = L;

run('AC-69', async () => {
  const d = L.evDir('AC-69');
  const browser = await L.launch();
  const at = await L.apiToken('alice', process.env.ALICE_PASSWORD);
  const tooLong = await fetch(API + '/v1/projects', { method: 'POST', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'L'.repeat(200) }) });
  L.note(`API create with a 200-character name -> HTTP ${tooLong.status} (names are capped at 100; 200-character text is injected into the DOM below)`);
  const long1 = await L.apiCreate(at, 'W'.repeat(100));
  const long2 = await L.apiCreate(at, 'Long project name with many words '.repeat(3).slice(0, 100).trim());
  const lctx = await browser.newContext();
  await login(await lctx.newPage(), 'alice', process.env.ALICE_PASSWORD);
  const storage = await lctx.storageState();
  await lctx.close();
  const configs = [
    { name: '375x812', viewport: { width: 375, height: 812 }, dsf: 1, mobile: true },
    { name: '1280x800', viewport: { width: 1280, height: 800 }, dsf: 1 },
    { name: '2560x1080', viewport: { width: 2560, height: 1080 }, dsf: 1 },
    { name: '1280-at-200pct-zoom', viewport: { width: 640, height: 400 }, dsf: 2 },
  ];
  const views = [
    ['list', '/projects', false],
    ['list-200char-injected', '/projects', true],
    ['detail-100char', '/projects/' + long1.id, false],
    ['detail-200char-injected', '/projects/' + long2.id, true],
    ['signed-out', '/signed-out', false],
  ];
  for (const c of configs) {
    for (const motion of ['no-preference', 'reduce']) {
      const ctx = await browser.newContext({ viewport: c.viewport, deviceScaleFactor: c.dsf, storageState: storage, reducedMotion: motion });
      const page = await ctx.newPage();
      for (const [label, url, inject] of views) {
        await page.goto(BASE + url);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300);
        if (inject) await page.evaluate(() => {
          const text = 'X'.repeat(120) + ' ' + 'Y'.repeat(79);
          document.querySelectorAll('main li a, main h1').forEach((e, i) => { if (i < 4) e.textContent = text; });
        });
        const m = await page.evaluate((mobile) => {
          const minTarget = mobile ? 44 : 24;
          const small = [];
          for (const e of document.querySelectorAll('button, a, input, [role=button]')) {
            if (e.type === 'hidden') continue;
            const r = e.getBoundingClientRect();
            if (r.width === 0 && r.height === 0) continue;
            if (r.width < minTarget || r.height < minTarget) small.push({ tag: e.tagName, text: (e.textContent || e.value || '').slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
          }
          const inputs = [...document.querySelectorAll('input:not([type=hidden]), textarea, select')].map((e) => parseFloat(getComputedStyle(e).fontSize));
          const clipped = [...document.querySelectorAll('main h1, main p, main a, main span, main label, main button')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').map((e) => e.tagName);
          const overflowing = [...document.querySelectorAll('main *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && !e.classList.contains('skip'); }).map((e) => e.tagName + ':' + Math.round(e.getBoundingClientRect().right));
          const overlaps = [];
          for (const li of document.querySelectorAll('main li')) {
            const link = li.querySelector('a');
            const span = li.querySelector('span');
            if (link && span) {
              const ra = link.getBoundingClientRect();
              const rs = span.getBoundingClientRect();
              if (ra.right > rs.left + 1 && ra.left < rs.right - 1 && ra.bottom > rs.top + 1 && ra.top < rs.bottom - 1) overlaps.push(link.textContent.slice(0, 20));
            }
          }
          const animated = [...document.querySelectorAll('*')].map((e) => {
            const cs = getComputedStyle(e);
            return { a: cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0 ? cs.animationName + ' ' + cs.animationDuration : null, t: cs.transitionDuration.split(',').some((x) => parseFloat(x) > 0) ? cs.transitionProperty + ' ' + cs.transitionDuration : null };
          }).filter((x) => x.a || x.t);
          return { hScroll: document.documentElement.scrollWidth > innerWidth, scrollWidth: document.documentElement.scrollWidth, innerWidth, small, inputFontPx: inputs, clipped, overflowing: overflowing.slice(0, 5), overlaps, animated: animated.slice(0, 5) };
        }, Boolean(c.mobile));
        const fontOk = !c.mobile || m.inputFontPx.every((f) => f >= 16);
        const motionOk = motion === 'no-preference' || m.animated.length === 0;
        const ok = !m.hScroll && m.small.length === 0 && fontOk && m.clipped.length === 0 && m.overflowing.length === 0 && m.overlaps.length === 0 && motionOk;
        check(`${c.name} motion=${motion} ${label}: no horizontal scroll, targets, input font, no clipping/overlap${motion === 'reduce' ? ', no animation' : ''}`, ok, ok ? `scrollWidth=${m.scrollWidth} innerWidth=${m.innerWidth}` : m);
        if (motion === 'no-preference') await page.screenshot({ path: path.join(d, `${c.name}-${label}.png`), fullPage: true });
      }
      await ctx.close();
    }
  }
});
