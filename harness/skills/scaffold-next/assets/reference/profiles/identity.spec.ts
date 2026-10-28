import { test, expect } from '@playwright/test';
import { createClient } from '@redis/client';
import { request as http } from 'node:http';
test('OIDC sign-in, persisted change, CSRF rejection, refresh and logout invalidate a copied cookie', async ({
  page,
  context,
  request,
}) => {
  // Private pages redirect straight to sign-in; the test issuer signs in and returns to the requested page.
  await page.goto('/projects?secret=never-log-this');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === 'app_session');
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  expect(cookies.some((c) => c.name === 'api_session')).toBe(false);
  expect((await request.post('/auth/logout', { headers: { origin: 'https://wrong.example' } })).status()).toBe(403);
  const name = 'OIDC saved ' + Date.now();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('status')).toContainText('Project created.');
  await page.reload();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  expect((await page.request.post('/auth/refresh', { headers: { origin: process.env.WEB_TEST_URL! } })).status()).toBe(
    204,
  );
  // The session ends while the form is open (for example, signed out in another tab). Saving keeps the input and
  // offers sign-in in a new tab; after signing in there, saving here works.
  expect(
    (
      await page.request.post('/auth/logout', { headers: { origin: process.env.WEB_TEST_URL! }, maxRedirects: 0 })
    ).status(),
  ).toBeLessThan(400);
  const kept = 'Kept after expiry ' + Date.now();
  await page.getByLabel('Project name').fill(kept);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('status')).toContainText('Your session expired');
  await expect(page.getByLabel('Project name')).toHaveValue(kept);
  const signInTab = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Sign in again (opens a new tab)' }).click();
  const tab = await signInTab;
  await expect(tab.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await tab.close();
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('status')).toContainText('Project created.');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Signed out', exact: true })).toBeVisible();
  await context.addCookies([session!]);
  // The copied cookie no longer names a session: the page redirects to sign-in instead of rendering.
  const replay = await page.request.get('/projects', { maxRedirects: 0 });
  expect(replay.status()).toBe(307);
  expect(replay.headers().location).toContain('/auth/login');
  // The stale cookie is left alone: it grants nothing, and clearing it could race a newer sign-in's cookie.
  expect(replay.headers()['set-cookie']).toBeUndefined();
  const callback = await request.get('/auth/callback?code=forged&state=forged', { maxRedirects: 0 });
  expect(callback.status()).toBe(303);
  expect(callback.headers().location).toContain('/sign-in-problem');
});
// Plain HTTP with exact headers and no cookie jar. (fetch() always sends Sec-Fetch-Mode: cors, which is not a navigation.)
type Reply = { status: number; location: string; cookies: string[] };
function get(url: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http(new URL(url, process.env.WEB_TEST_URL), { headers }, (res) => {
      res.resume();
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          location: res.headers.location ?? '',
          cookies: res.headers['set-cookie'] ?? [],
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}
const navigate = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
const txCookie = (reply: Reply) => reply.cookies.find((c) => /^oidc_tx_[0-9a-f]{16}=[^;]/.test(c));
const pair = (setCookie: string) => setCookie.split(';')[0]!;
// Starts a sign-in as a browser navigation and follows the test issuer to the callback URL.
async function start(returnTo = '/projects') {
  const login = await get('/auth/login?returnTo=' + encodeURIComponent(returnTo), navigate);
  expect(login.status).toBe(303);
  const cookie = txCookie(login)!;
  expect(cookie).toBeDefined();
  const issued = await get(login.location);
  return { login, cookie, callback: new URL(issued.location) };
}
const callbackPath = (url: URL) => url.pathname + url.search;
const rejected = (reply: Reply) => {
  expect(reply.status).toBe(303);
  expect(reply.location).toContain('/sign-in-problem?reason=rejected');
  expect(reply.cookies.some((c) => /^app_session=[^;]/.test(c))).toBe(false);
};

test('sign-in transactions live only in sealed, bounded, per-sign-in cookies', async () => {
  const redis = createClient({ url: process.env.TEST_REDIS_URL! });
  await redis.connect();
  const count = async () => (await redis.keys(process.env.AUTH_NAMESPACE + ':*')).length;
  try {
    const before = await count();
    const starts = await Promise.all(Array.from({ length: 25 }, () => start()));
    expect(await count()).toBe(before);
    expect(new Set(starts.map((s) => s.cookie.split('=')[0])).size).toBe(25);
    for (const { cookie } of starts) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=lax/i);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).toMatch(/Max-Age=300/);
      expect(cookie.length).toBeLessThan(2048);
    }
    const [a, b] = starts as [Awaited<ReturnType<typeof start>>, Awaited<ReturnType<typeof start>>];
    const [name, value] = pair(a.cookie).split('=') as [string, string];
    const at = value.length - 10;
    const tampered = name + '=' + value.slice(0, at) + (value[at] === 'A' ? 'B' : 'A') + value.slice(at + 1);
    const refused = await get(callbackPath(a.callback), { cookie: tampered });
    rejected(refused);
    expect(refused.cookies.some((c) => c.startsWith(name + '=;'))).toBe(true);
    rejected(await get(callbackPath(a.callback)));
    rejected(await get(callbackPath(a.callback), { cookie: pair(b.cookie) }));
    // Two tabs: both transactions are present and each callback completes with its own.
    const both = pair(a.cookie) + '; ' + pair(b.cookie);
    for (const tab of [b, a]) {
      const done = await get(callbackPath(tab.callback), { cookie: both });
      expect(done.status).toBe(303);
      expect(done.location).toBe(process.env.WEB_TEST_URL + '/projects');
      expect(done.cookies.some((c) => /^app_session=[^;]/.test(c))).toBe(true);
      const own = pair(tab.cookie).split('=')[0]!;
      expect(done.cookies.some((c) => c.startsWith(own + '=;'))).toBe(true);
      expect(done.cookies.filter((c) => /^oidc_tx_/.test(c))).toHaveLength(1);
    }
    // Replaying a used callback with its cookie: the code is spent, so no second session.
    rejected(await get(callbackPath(a.callback), { cookie: pair(a.cookie) }));
    // A browser carries at most five sign-ins in progress: starting another clears the oldest.
    const six = starts
      .slice(2, 8)
      .map((s) => pair(s.cookie))
      .join('; ');
    const pruned = await get('/auth/login', { ...navigate, cookie: six });
    expect(pruned.cookies.filter((c) => /^oidc_tx_[0-9a-f]{16}=;/.test(c))).toHaveLength(2);
  } finally {
    await redis.quit();
  }
});

test('prefetches and client-router requests never start a sign-in or touch cookies', async () => {
  const base = process.env.WEB_TEST_URL!;
  const redis = createClient({ url: process.env.TEST_REDIS_URL! });
  await redis.connect();
  try {
    const before = await redis.keys(process.env.AUTH_NAMESPACE + ':*');
    const variants: Record<string, string>[] = [
      { rsc: '1', 'next-router-prefetch': '1' },
      { rsc: '1', 'next-router-state-tree': '%5B%22%22%5D' },
      { 'sec-purpose': 'prefetch' },
      { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
      { 'sec-fetch-mode': 'no-cors' },
    ];
    for (const headers of variants) {
      for (const path of ['/auth/login?returnTo=/projects', '/projects', '/projects?_rsc=abc']) {
        const sent = { ...headers, cookie: 'app_session=' + 'A'.repeat(43) };
        let reply = await get(path, sent);
        // Next.js answers an RSC request whose _rsc cache key does not match its headers with a 307 to the same path
        // carrying the right key (the client router always sends the right one). Follow that once, as the router would.
        if ('rsc' in headers && reply.status === 307 && new URL(reply.location, base).pathname === path.split('?')[0]) {
          expect(reply.cookies, path).toEqual([]);
          reply = await get(reply.location, sent);
        }
        if (path.startsWith('/auth/login') || 'rsc' in headers) expect(reply.status, path).toBe(204);
        expect(reply.cookies, path).toEqual([]);
      }
    }
    expect(await redis.keys(process.env.AUTH_NAMESPACE + ':*')).toEqual(before);
  } finally {
    await redis.quit();
  }
});

test('re-login survives a prefetch still carrying the old session cookie', async ({ page, context }) => {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  const old = (await context.cookies()).find((c) => c.name === 'app_session')!;
  // Sign in again while signed in (same account): the old session is replaced.
  await page.goto('/auth/login?returnTo=/projects');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  const renewed = (await context.cookies()).find((c) => c.name === 'app_session')!;
  expect(renewed.value).not.toBe(old.value);
  // A link prefetch sent before the re-login completed arrives now, still with the old cookie.
  const stale = { cookie: 'app_session=' + old.value };
  for (const headers of [
    { ...stale, rsc: '1', 'next-router-prefetch': '1' },
    { ...stale, rsc: '1' },
    { ...stale, ...navigate },
  ]) {
    const reply = await get('/projects?_rsc=late', headers);
    expect(reply.cookies).toEqual([]);
  }
  // The browser still holds the new session and stays signed in, including through a token refresh.
  expect((await context.cookies()).find((c) => c.name === 'app_session')?.value).toBe(renewed.value);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  expect((await page.request.post('/auth/refresh', { headers: { origin: process.env.WEB_TEST_URL! } })).status()).toBe(
    204,
  );
  // Client-side navigation to a private page after the old session is gone still works (no stale prefetch redirect).
  const link = page.locator('a[href^="/projects/"]').first();
  if (await link.count()) {
    await link.click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  }
});
