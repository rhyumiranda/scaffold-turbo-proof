import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  workers: 1,
  // Generous, explicit waits: real production builds on a busy CI host are slow, and slow must not mean flaky.
  timeout: 60000,
  expect: { timeout: Number(process.env.PLAYWRIGHT_EXPECT_TIMEOUT ?? 10000) },
  use: { baseURL: process.env.WEB_TEST_URL ?? 'http://127.0.0.1:4300', trace: 'retain-on-failure' },
});
