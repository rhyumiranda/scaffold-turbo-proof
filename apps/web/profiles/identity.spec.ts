import { test, expect } from '@playwright/test';
test('OIDC sign-in, persisted change, CSRF rejection, refresh and logout invalidate a copied cookie', async ({
  page,
  context,
  request,
}) => {
  await page.goto('/projects?secret=never-log-this');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
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
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Signed out', exact: true })).toBeVisible();
  await context.addCookies([session!]);
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Sign in required' })).toBeVisible();
  const callback = await request.get('/auth/callback?code=forged&state=forged');
  expect(callback.status()).toBe(400);
});
