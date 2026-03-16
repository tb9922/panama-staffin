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
    // Wait for app to load
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15_000 });

    // Check key nav groups exist
    await expect(page.getByText('Scheduling')).toBeVisible();
    await expect(page.getByText('Staff')).toBeVisible();
    await expect(page.getByText('Compliance')).toBeVisible();
  });
});
