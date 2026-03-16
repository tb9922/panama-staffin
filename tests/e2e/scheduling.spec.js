import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Scheduling — Roster', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/rotation');
    await expect(page.getByRole('heading', { name: /Rotation/i })).toBeVisible({ timeout: 15_000 });
  });

  test('roster grid renders with staff rows', async ({ page }) => {
    const table = page.locator('table');
    await expect(table).toBeVisible();
    const rows = table.locator('tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  });

  test('month navigation updates the grid', async ({ page }) => {
    const nextBtn = page.getByRole('button', { name: /next|→|▶/i });
    if (await nextBtn.isVisible()) {
      const heading = await page.locator('h1, h2, h3').first().textContent();
      await nextBtn.click();
      await expect(page.locator('h1, h2, h3').first()).not.toHaveText(heading, { timeout: 5_000 });
    }
  });
});

test.describe('Scheduling — Daily Status', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/day');
    await expect(page.getByRole('heading', { name: /Daily Status|Day View/i })).toBeVisible({ timeout: 15_000 });
  });

  test('shows coverage periods', async ({ page }) => {
    await expect(page.getByText(/early/i)).toBeVisible({ timeout: 10_000 });
  });

  test('staff list is visible', async ({ page }) => {
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });
  });
});
