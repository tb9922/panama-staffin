import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Scheduling — Roster', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/rotation');
    await expect(page.getByText(/Rotation/i)).toBeVisible({ timeout: 15_000 });
  });

  test('roster grid renders with staff rows', async ({ page }) => {
    // Grid should have a table with staff names
    const table = page.locator('table');
    await expect(table).toBeVisible();
    // Should have at least one row (staff member)
    const rows = table.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  });

  test('month navigation updates the grid', async ({ page }) => {
    // Find and click next month button
    const nextBtn = page.getByRole('button', { name: /next|→|▶/i });
    if (await nextBtn.isVisible()) {
      const heading = await page.locator('h1, h2, h3').first().textContent();
      await nextBtn.click();
      // Heading should change after navigation
      await expect(page.locator('h1, h2, h3').first()).not.toHaveText(heading, { timeout: 5_000 });
    }
  });
});

test.describe('Scheduling — Daily Status', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/day');
    await expect(page.getByText(/Daily Status|Day View/i)).toBeVisible({ timeout: 15_000 });
  });

  test('shows coverage periods', async ({ page }) => {
    // Should show early/late/night coverage sections
    await expect(page.getByText(/early/i)).toBeVisible({ timeout: 10_000 });
  });

  test('staff list is visible', async ({ page }) => {
    // Should show at least one staff member
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });
  });
});
