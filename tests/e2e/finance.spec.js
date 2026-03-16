import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Finance Module', () => {
  test('Finance Dashboard renders KPIs', async ({ page }) => {
    await page.goto('/finance');
    await expect(page.getByRole('heading', { name: /Finance/i })).toBeVisible({ timeout: 15_000 });
    // Dashboard has sub-headings like "Receivables Ageing" once loaded
    await expect(page.getByRole('heading', { name: /Receivables|Revenue|Income|Expense/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test('Income page loads with table', async ({ page }) => {
    await page.goto('/finance/income');
    await expect(page.getByRole('heading', { name: /Income|Billing|Invoice/i })).toBeVisible({ timeout: 15_000 });
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });
  });

  test('Expenses page loads with table', async ({ page }) => {
    await page.goto('/finance/expenses');
    await expect(page.getByRole('heading', { name: /Expense/i })).toBeVisible({ timeout: 15_000 });
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });
  });

  test('Expenses page has Add button', async ({ page }) => {
    await page.goto('/finance/expenses');
    await expect(page.getByRole('heading', { name: /Expense/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Add Expense/i })).toBeVisible();
  });
});
