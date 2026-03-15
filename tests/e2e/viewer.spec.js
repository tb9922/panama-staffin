import { test, expect } from '@playwright/test';

// This spec runs with viewer auth state (see playwright.config.js viewer project)

test.describe('Viewer Role Restrictions', () => {
  test('viewer cannot see Add Staff button', async ({ page }) => {
    await page.goto('/staff');
    await expect(page.getByText('Staff Database')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Add Staff/i })).not.toBeVisible();
  });

  test('viewer cannot see Finance nav section', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Finance')).not.toBeVisible();
  });

  test('viewer cannot see HR nav section', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('HR & People')).not.toBeVisible();
  });

  test('viewer accessing restricted page sees no write controls', async ({ page }) => {
    // Even if viewer navigates directly to a restricted URL, write controls should be hidden
    await page.goto('/incidents');
    // Page may load (read access) or redirect — either way, no Log Incident button
    await page.waitForTimeout(3_000);
    await expect(page.getByRole('button', { name: /Log Incident|Add|New/i })).not.toBeVisible();
  });
});
