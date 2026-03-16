import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Excel & PDF Exports', () => {
  test('Audit Log page loads with export button', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: /Audit/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Export Excel/i })).toBeVisible();
  });

  test('CQC Evidence page loads', async ({ page }) => {
    await page.goto('/cqc');
    await expect(page.getByRole('heading', { name: /CQC/i })).toBeVisible({ timeout: 15_000 });
  });

  test('Reports page loads with generate button', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: /Report/i }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Generate|PDF/i }).first()).toBeVisible();
  });
});
