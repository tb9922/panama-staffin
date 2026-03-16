import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders dashboard heading', async ({ page }) => {
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15_000 });
  });

  test('shows coverage section', async ({ page }) => {
    await expect(page.getByText(/Coverage/i)).toBeVisible({ timeout: 15_000 });
  });

  test('shows staffing summary', async ({ page }) => {
    await expect(page.getByText(/Staffing Summary/i)).toBeVisible({ timeout: 15_000 });
  });

  test('sidebar navigation is visible', async ({ page }) => {
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15_000 });
    // Check nav group buttons exist in sidebar
    await expect(page.getByRole('button', { name: 'Scheduling' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Staff$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compliance' })).toBeVisible();
  });
});
