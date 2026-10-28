'use strict';
// AC-68: private pages are never cached or shared across users.
const L = require('./lib.cjs');
const { BASE, API, check, seen, login, run, path, fs } = L;
const { execFileSync } = require('node:child_process');
const cacheOk = (value) => /\b(private|no-store)\b/i.test(value || '');

run('AC-68', async () => {
  const d = L.evDir('AC-68');
  const browser = await L.launch();
  const actx = await browser.newContext();
  const bctx = await browser.newContext();
  const a = await actx.newPage();
  const b = await bctx.newPage();
  a.on('dialog', (x) => x.accept());
  b.on('dialog', (x) => x.accept());
  await login(a, 'alice', process.env.ALICE_PASSWORD);
  await login(b, 'bob', process.env.BOB_PASSWORD);
  const at = await L.apiToken('alice', process.env.ALICE_PASSWORD);
  const p = await L.apiCreate(at, 'AC68 alice header ' + Date.now());
  const cookies = (await actx.cookies()).filter((c) => c.name === 'app_session' || c.name === '__Host-app_session');
  check('alice has a session cookie on the app origin', cookies.length > 0, cookies.map((c) => c.name).join(','));
  const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const hf = path.join(process.env.WORK, 'ux', 'cookie-hdr.txt');
  fs.writeFileSync(hf, 'Cookie: ' + header + '\n', { mode: 0o600 });
  const out = [];
  for (const u of ['/projects', '/projects/' + p.id, '/projects?page=2']) {
    for (const [label, args] of [['HEAD', ['-sI']], ['GET', ['-s', '-D', '-', '-o', '/dev/null']]]) {
      const text = execFileSync('curl', [...args, '-H', '@' + hf, BASE + u]).toString();
      const status = text.split('\n')[0].trim();
      const cc = (text.match(/^cache-control:.*$/im) || ['cache-control: <missing>'])[0].trim();
      out.push(`$ curl ${args.join(' ')} -H @<cookie-file> ${BASE}${u}\n${text.replace(/^set-cookie:.*$/gim, 'set-cookie: <redacted>')}`);
      check(`${label} ${u.replace(p.id, '{id}')}: 200 with private/no-store`, / 200\b/.test(status) && cacheOk(cc), `${status} | ${cc}`);
    }
  }
  const apiHead = execFileSync('curl', ['-sI', '-H', 'Authorization: Bearer ' + at, API + '/v1/projects']).toString();
  const apiCc = (apiHead.match(/^cache-control:.*$/im) || ['cache-control: <missing>'])[0].trim();
  out.push('$ curl -sI -H "Authorization: Bearer <alice>" ' + API + '/v1/projects\n' + apiHead);
  check('API GET /v1/projects (data response) is private/no-store', cacheOk(apiCc), apiCc);
  fs.unlinkSync(hf);
  fs.writeFileSync(path.join(d, 'curl-headers.txt'), out.join('\n'));

  const actionCache = [];
  a.on('response', (r) => { if (r.request().method() === 'POST' && r.request().headers()['next-action']) actionCache.push(r.headers()['cache-control'] ?? '<missing>'); });
  const A = [];
  const B = [];
  let leaks = 0;
  let notOwn = 0;
  for (let i = 0; i < 20; i++) {
    for (const [pg, mine, other, who] of [[a, A, B, 'alice'], [b, B, A, 'bob']]) {
      await pg.goto(BASE + '/projects');
      await seen(pg.getByRole('button', { name: 'Create project' }));
      const name = `AC68 ${who} round ${i} ${Date.now()}`;
      await pg.getByLabel('Project name').fill(name);
      await pg.getByRole('button', { name: 'Create project' }).click();
      await seen(pg.getByRole('status').filter({ hasText: 'Project created.' }));
      mine.push(name);
      if (i % 2 === 0) {
        await pg.getByRole('link', { name: 'Open created project' }).click();
        await seen(pg.getByRole('heading', { name }));
        const renamed = name + ' renamed';
        await pg.getByLabel('Project name').fill(renamed);
        await pg.getByRole('button', { name: 'Save name' }).click();
        await seen(pg.getByRole('status').filter({ hasText: 'Project renamed.' }));
        mine[mine.length - 1] = renamed;
      }
      await pg.goto(BASE + '/projects');
      await seen(pg.getByRole('button', { name: 'Create project' }));
      const html = await pg.content();
      if (other.some((n) => html.includes(n))) { leaks++; console.log(`LEAK round ${i}: ${who} saw another user's project`); }
      if (!mine.slice(-1).every((n) => html.includes(n))) notOwn++;
    }
  }
  check('20 alternating rounds: no project name ever crossed between alice and bob', leaks === 0, `leaks=${leaks} alice=${A.length} bob=${B.length}`);
  check('20 alternating rounds: each user saw their own latest write immediately', notOwn === 0, `missing=${notOwn}`);
  check('Server Action (data) responses are private/no-store', actionCache.length > 0 && actionCache.every(cacheOk), [...new Set(actionCache)].join(' | '));

  // Sign out alice, then Back and reload.
  await a.goto(BASE + '/projects/' + p.id);
  await seen(a.getByRole('heading', { name: p.name }));
  await a.goto(BASE + '/projects');
  await seen(a.getByRole('button', { name: 'Sign out' }));
  await a.getByRole('button', { name: 'Sign out' }).click();
  await a.waitForURL(/signed-out/);
  await a.goBack();
  await a.waitForTimeout(2000);
  await a.screenshot({ path: path.join(d, 'after-signout-back.png') });
  const privateText = (text) => A.some((n) => text.includes(n)) || text.includes(p.name);
  await a.reload();
  await a.waitForLoadState('load');
  await a.waitForTimeout(1500);
  const dom = await a.content();
  await a.screenshot({ path: path.join(d, 'after-signout-back-reload.png') });
  const signIn = /\/realms\/acme\//.test(a.url()) || (await a.getByRole('heading', { name: /sign in/i }).count()) > 0;
  check('after sign-out, Back and reload shows sign-in', signIn, a.url().split('?')[0]);
  check('after sign-out, Back and reload leaves no private text in the DOM', !privateText(dom));
  await a.goBack().catch(() => {});
  await a.waitForTimeout(1500);
  await a.reload().catch(() => {});
  await a.waitForTimeout(1500);
  check('going Back again to the detail page and reloading also shows no private text', !privateText(await a.content()), a.url().split('?')[0]);
});
