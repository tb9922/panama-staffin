import { test, expect } from '@playwright/test';

test.describe('RBAC — Admin access', () => {
  // Uses pre-authenticated admin state
  test('admin sees Add Staff button', async ({ page }) => {
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Add Staff/i })).toBeVisible();
  });
});

test.describe('RBAC — Viewer restrictions', () => {
  // Override to use viewer state
  test.use({ storageState: '.playwright/viewer-state.json' });

  test('viewer does NOT see Add Staff button', async ({ page }) => {
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Add Staff/i })).not.toBeVisible();
  });

  test('viewer does NOT see admin-only nav sections', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
    // HR & People and Finance are admin-only nav groups
    await expect(page.getByRole('button', { name: 'HR & People' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Finance' })).not.toBeVisible();
  });
});
