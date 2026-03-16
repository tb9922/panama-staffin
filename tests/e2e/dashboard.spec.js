import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders dashboard heading', async ({ page }) => {
    // Diagnostic: wait 3s then log page state to help debug CI failures
    await page.waitForTimeout(3_000);
    const url = page.url();
    const title = await page.title();
    const bodyText = await page.locator('body').innerText().catch(() => '(could not get body text)');
    console.log(`[DIAG] URL: ${url}, Title: ${title}`);
    console.log(`[DIAG] Body text (first 500 chars): ${bodyText.slice(0, 500)}`);
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
