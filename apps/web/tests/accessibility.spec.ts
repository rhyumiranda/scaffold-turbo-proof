import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('automated accessibility covers signed-out, list, invalid form and 200% text reflow', async ({
  page,
  context,
}) => {
  await page.goto('/projects');
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations,
  ).toEqual([]);
  const token = process.env.TEST_ALICE_TOKEN;
  if (!token) throw new Error('Real API identity required');
  await context.addCookies([
    { name: 'api_session', value: token, url: process.env.WEB_TEST_URL!, httpOnly: true, sameSite: 'Lax' },
  ]);
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Create project' }).click();
  expect(
    (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 640, height: 720 });
  // 200% text resize plus narrowed layout. This supplements, not substitutes for native browser zoom testing.
  await page.locator('html').evaluate((element) => (element.style.fontSize = '200%'));
  await expect(page.getByLabel('Project name')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel('Project name').fill('Accessible project');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('status')).toContainText('Project created.');
});
