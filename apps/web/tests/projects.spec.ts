import { test, expect } from '@playwright/test';

test('stale write shows a conflict and retains the unsaved name', async ({ page }) => {
  const api = process.env.TEST_API_URL,
    token = process.env.TEST_ALICE_TOKEN;
  if (!api || !token) throw new Error('Real API test context required');
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const created = await fetch(api + '/v1/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Conflict ' + Date.now() }),
  });
  expect(created.status).toBe(201);
  const project = await created.json();
  await page.goto('/projects/' + project.id);
  const competing = await fetch(api + '/v1/projects/' + project.id, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name: 'Someone else saved', expectedVersion: 1 }),
  });
  expect(competing.status).toBe(200);
  await page.getByLabel('Project name').fill('My unsaved edit');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status')).toContainText('This project changed since you opened it.');
  await expect(page.getByLabel('Project name')).toHaveValue('My unsaved edit');
  // The conflict is shown next to the field and linked to it, not only announced.
  await expect(page.getByLabel('Project name')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#name-error')).toContainText('This project changed since you opened it.');
  await expect(page.getByLabel('Project name')).toHaveAttribute('aria-describedby', 'name-error');
});
test('layout remains usable at laptop and ultrawide sizes', async ({ page }) => {
  for (const width of [1366, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/projects');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Create project' })).toBeVisible();
  }
});
test.beforeEach(async ({ context }) => {
  const token = process.env.TEST_ALICE_TOKEN;
  if (!token) throw new Error('TEST_ALICE_TOKEN and a real reference API are required; no fixture-only pass');
  await context.addCookies([
    {
      name: 'api_session',
      value: token,
      url: process.env.WEB_TEST_URL ?? 'http://127.0.0.1:4300',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
});
test('create, validate, rename, reload and reject another user', async ({ page, context }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Enter a project name.')).toBeVisible();
  await expect(page.getByLabel('Project name')).toBeFocused();
  const name = 'Browser project ' + Date.now();
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('status')).toContainText('Project created.');
  await page.getByRole('link', { name: 'Open created project', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByLabel('Project name').fill(name + ' renamed');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('status')).toContainText('Project renamed.');
  await page.reload();
  await expect(page.getByRole('heading', { name: name + ' renamed', exact: true })).toBeVisible();
  const bob = process.env.TEST_BOB_TOKEN;
  if (!bob) throw new Error('TEST_BOB_TOKEN required');
  await context.addCookies([
    {
      name: 'api_session',
      value: bob,
      url: process.env.WEB_TEST_URL ?? 'http://127.0.0.1:4300',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Project not found' })).toBeVisible();
});
test('forged session does not reveal private data', async ({ page, context }) => {
  await context.clearCookies();
  await context.addCookies([
    {
      name: 'api_session',
      value: 'forged',
      url: process.env.WEB_TEST_URL ?? 'http://127.0.0.1:4300',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Sign in required' })).toBeVisible();
});
test('keyboard focus and mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/projects');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByLabel('Project name')).toBeVisible();
});
test('strict CSP blocks injected script while the real form stays interactive', async ({ page }) => {
  const blocked = page.waitForEvent('console', {
    predicate: (message) =>
      message.type() === 'error' &&
      message.text().includes('Executing inline script violates') &&
      message.text().includes('Content Security Policy'),
  });
  await page.route('**/projects', async (route) => {
    if (!route.request().isNavigationRequest() || route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const html = await response.text();
    expect(html).toContain('<head>');
    // Fault-inject parser HTML, not trusted runtime script creation under strict-dynamic.
    await route.fulfill({
      response,
      body: html.replace('<head>', "<head><script>document.documentElement.dataset.injectedScript='ran'</script>"),
    });
  });
  const response = await page.goto('/projects');
  const policy = response?.headers()['content-security-policy'];
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
  await blocked;
  expect(await page.evaluate(() => document.documentElement.dataset.injectedScript)).toBeUndefined();
  expect(
    await page
      .locator('script[nonce]')
      .first()
      .evaluate((script) => ((script as HTMLScriptElement).nonce ?? '').length),
  ).toBeGreaterThan(10);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Enter a project name.')).toBeVisible();
});
test('pagination survives refresh and browser history; invalid page is rejected', async ({ page }) => {
  const api = process.env.TEST_API_URL,
    token = process.env.TEST_ALICE_TOKEN;
  if (!api || !token) throw new Error('Real API context required');
  for (let i = 0; i < 26; i++) {
    const response = await fetch(api + '/v1/projects', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Pagination ${Date.now()} ${i}` }),
    });
    expect(response.status).toBe(201);
  }
  await page.goto('/projects');
  await page.getByRole('link', { name: 'Next page' }).click();
  await expect(page).toHaveURL(/page=2/);
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Project pages' })).toContainText('Page 2');
  await page.getByRole('link', { name: 'Previous page' }).click();
  await expect(page).toHaveURL(/page=1/);
  await page.goBack();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByRole('navigation', { name: 'Project pages' })).toContainText('Page 2');
  await page.goto('/projects?page=0');
  await expect(page.getByRole('heading', { name: 'Project not found' })).toBeVisible();
});
test('record a throttled production-navigation sample', async ({ page }, testInfo) => {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 100,
    downloadThroughput: 800000,
    uploadThroughput: 250000,
  });
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const started = Date.now();
  await page.goto('/projects');
  await expect(page.getByRole('button', { name: 'Create project' })).toBeVisible();
  const sample = await page.evaluate(() => ({
    navigation: performance.getEntriesByType('navigation').map((e) => e.toJSON()),
    resources: performance
      .getEntriesByType('resource')
      .map((e) => ({ name: new URL(e.name).pathname, duration: e.duration })),
  }));
  await testInfo.attach('production-navigation-sample', {
    body: JSON.stringify({
      assumptions: { cpuSlowdown: 4, latencyMs: 100, downloadBytesPerSecond: 800000 },
      elapsedMs: Date.now() - started,
      ...sample,
    }),
    contentType: 'application/json',
  });
  await session.detach();
});
