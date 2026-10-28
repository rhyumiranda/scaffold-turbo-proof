import { test, expect } from '@playwright/test';
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
  // The stale cookie is cleared with the same attributes it was set with, or the browser would ignore the clearing.
  const cleared = replay.headers()['set-cookie'] ?? '';
  expect(cleared).toMatch(/app_session=;/);
  expect(cleared).toMatch(/HttpOnly/i);
  expect(cleared).toMatch(/SameSite=lax/i);
  const callback = await request.get('/auth/callback?code=forged&state=forged', { maxRedirects: 0 });
  expect(callback.status()).toBe(303);
  expect(callback.headers().location).toContain('/sign-in-problem');
});
