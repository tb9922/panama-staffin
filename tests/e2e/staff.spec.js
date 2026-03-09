import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Staff Register', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/staff');
    await expect(page.getByText('Staff Database')).toBeVisible({ timeout: 15_000 });
  });

  test('page loads with staff table', async ({ page }) => {
    // Table should be present with header row
    const table = page.locator('table');
    await expect(table).toBeVisible();
  });

  test('table has expected column headers', async ({ page }) => {
    await expect(page.getByRole('columnheader', { name: /Name/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Role/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Team/i })).toBeVisible();
  });

  test('Add Staff button visible for admin', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Add Staff/i })).toBeVisible();
  });
});
