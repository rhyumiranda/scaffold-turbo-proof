import { test, expect } from '@playwright/test';

const headers = () => ({ authorization: 'Bearer ' + process.env.TEST_ALICE_TOKEN, 'content-type': 'application/json' });
async function create(name: string) {
  const response = await fetch(process.env.TEST_API_URL + '/v1/projects', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name }),
  });
  expect(response.status).toBe(201);
  return response.json();
}
test.beforeEach(async ({ context }) => {
  if (!process.env.TEST_ALICE_TOKEN) throw new Error('Real API identity required');
  await context.addCookies([
    {
      name: 'api_session',
      value: process.env.TEST_ALICE_TOKEN,
      url: process.env.WEB_TEST_URL!,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
});

for (const mode of ['create', 'rename'] as const)
  for (const outcome of ['success', 'failure'] as const) {
    test(`${mode}: later edits survive a delayed ${outcome}`, async ({ page }) => {
      const project = mode === 'rename' ? await create('Before ' + Date.now()) : undefined;
      await page.goto(project ? '/projects/' + project.id : '/projects');
      if (project && outcome === 'failure') {
        const response = await fetch(process.env.TEST_API_URL + '/v1/projects/' + project.id, {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify({ name: 'Competing save', expectedVersion: 1 }),
        });
        expect(response.status).toBe(200);
      }
      const submitted = outcome === 'failure' && mode === 'create' ? '   ' : 'Submitted ' + Date.now();
      await page.getByLabel('Project name').fill(submitted);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let arrived!: () => void;
      const responseReady = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      await page.route('**/projects**', async (route) => {
        if (route.request().method() !== 'POST') {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        arrived();
        await held;
        await route.fulfill({ response });
      });
      const button = page.getByRole('button', { name: mode === 'create' ? 'Create project' : 'Save name' });
      await button.click();
      await responseReady;
      await expect(button).toBeDisabled();
      await page.getByLabel('Project name').fill('Later draft');
      release();
      await expect(button).toBeEnabled();
      await expect(page.getByRole('status')).toContainText(
        outcome === 'success'
          ? mode === 'create'
            ? 'Project created.'
            : 'Project renamed.'
          : mode === 'create'
            ? 'Check the project name.'
            : 'This project changed since you opened it.',
      );
      await expect(page.getByLabel('Project name')).toHaveValue('Later draft');
      const dialog = page.waitForEvent('dialog');
      const reload = page.reload({ timeout: 1500 }).catch(() => {});
      await (await dialog).dismiss();
      await reload;
      await expect(page.getByLabel('Project name')).toHaveValue('Later draft');
      if (project && outcome === 'success') {
        await page.unroute('**/projects**');
        await button.click();
        await expect(page.getByRole('status')).toContainText('Project renamed.');
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Later draft', exact: true })).toBeVisible();
      }
    });
  }

test('history restores drafts; link/reload/external cancellation retains them; discard clears them', async ({
  page,
}) => {
  const project = await create('History ' + Date.now());
  await page.goto('/projects');
  await page.getByRole('link', { name: project.name, exact: true }).click();
  await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  await page.getByLabel('Project name').fill('Unsaved history draft');
  await page.goBack();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goForward();
  await expect(page.getByLabel('Project name')).toHaveValue('Unsaved history draft');
  const cancelLink = page.waitForEvent('dialog');
  const click = page.getByRole('link', { name: 'All projects', exact: true }).click();
  await (await cancelLink).dismiss();
  await click;
  await expect(page.getByLabel('Project name')).toHaveValue('Unsaved history draft');
  const cancelReload = page.waitForEvent('dialog');
  const reload = page.reload({ timeout: 1500 }).catch(() => {});
  await (await cancelReload).dismiss();
  await reload;
  await expect(page.getByLabel('Project name')).toHaveValue('Unsaved history draft');
  const cancelExternal = page.waitForEvent('dialog');
  const external = page.goto('about:blank', { timeout: 1500 }).catch(() => {});
  await (await cancelExternal).dismiss();
  await external;
  await expect(page.getByLabel('Project name')).toHaveValue('Unsaved history draft');
  const discard = page.waitForEvent('dialog');
  const leave = page.getByRole('link', { name: 'All projects', exact: true }).click();
  await (await discard).accept();
  await leave;
  await expect(page).toHaveURL(/\/projects$/);
  await page.goBack();
  await expect(page.getByLabel('Project name')).toHaveValue(project.name);
});

test('drafts never cross sessions', async ({ page, context }) => {
  await page.goto('/projects');
  await page.getByLabel('Project name').fill('Private Alice draft');
  // Provider integrations must use a full document transition when changing identity.
  await context.addCookies([
    {
      name: 'api_session',
      value: process.env.TEST_BOB_TOKEN!,
      url: process.env.WEB_TEST_URL!,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel('Project name')).toHaveValue('');
});

test('all mobile links and form controls meet the real 44px hit area', async ({ page }) => {
  const project = await create('X');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/projects');
  await expect(page.getByRole('link', { name: 'X', exact: true }).first()).toBeVisible();
  for (const target of await page.locator('main a, main button, main input:not([type=hidden])').all()) {
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await page.goto('/projects/' + project.id);
  const box = await page.getByRole('link', { name: 'All projects' }).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
});

test('unsupported text gets a field error and remains editable', async ({ page }) => {
  await page.goto('/projects');
  await page.getByLabel('Project name').fill('a\u0000b');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Remove the null character from the name.')).toBeVisible();
  await expect(page.getByLabel('Project name')).toHaveValue('a\u0000b');
  await expect(page.getByLabel('Project name')).toBeFocused();
});
