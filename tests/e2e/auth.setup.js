import { test as setup } from '@playwright/test';

const ADMIN = { username: 'admin', password: 'admin123' };
const VIEWER = { username: 'viewer', password: 'view123' };

setup('authenticate as admin', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Enter username').fill(ADMIN.username);
  await page.getByPlaceholder('Enter password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // Wait for dashboard to load (proves auth succeeded)
  await page.waitForSelector('text=Dashboard', { timeout: 15_000 });
  await page.context().storageState({ path: '.playwright/admin-state.json' });
});

setup('authenticate as viewer', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Enter username').fill(VIEWER.username);
  await page.getByPlaceholder('Enter password').fill(VIEWER.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForSelector('text=Dashboard', { timeout: 15_000 });
  await page.context().storageState({ path: '.playwright/viewer-state.json' });
});
