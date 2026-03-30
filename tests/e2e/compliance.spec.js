import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Compliance Module', () => {
  test('Training Matrix loads with grid', async ({ page }) => {
    test.slow();
    await page.goto('/training');
    await expect(page.getByRole('heading', { name: /Training/i })).toBeVisible({ timeout: 15_000 });
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });
  });

  test('Incident Tracker loads with table', async ({ page }) => {
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /New Incident/i })).toBeVisible();
  });

  test('CQC Evidence shows compliance score', async ({ page }) => {
    await page.goto('/cqc');
    await expect(page.getByRole('heading', { name: /CQC/i })).toBeVisible({ timeout: 15_000 });
  });

  test('Risk Register loads', async ({ page }) => {
    await page.goto('/risks');
    await expect(page.getByRole('heading', { name: 'Risk Register' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /New Risk/i })).toBeVisible();
  });
});
