import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15_000 });
  });

  test('navigate to Roster via sidebar', async ({ page }) => {
    await page.getByRole('button', { name: 'Scheduling' }).click();
    await page.getByRole('link', { name: 'Roster' }).click();
    await expect(page.getByRole('heading', { name: /Rotation/i })).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to Staff Database via sidebar', async ({ page }) => {
    await page.getByRole('button', { name: /^Staff$/ }).click();
    await page.getByRole('link', { name: 'Staff Database' }).click();
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to Training via sidebar', async ({ page }) => {
    await page.getByRole('button', { name: /^Staff$/ }).click();
    await page.getByRole('link', { name: 'Training' }).click();
    await expect(page.getByRole('heading', { name: /Training/i })).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to Incidents via sidebar', async ({ page }) => {
    await page.getByRole('button', { name: 'Compliance' }).click();
    await page.getByRole('link', { name: 'Incidents' }).click();
    await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to CQC Evidence via sidebar', async ({ page }) => {
    await page.getByRole('button', { name: 'Compliance' }).click();
    await page.getByRole('link', { name: 'CQC Evidence' }).click();
    await expect(page.getByRole('heading', { name: /CQC/i })).toBeVisible({ timeout: 10_000 });
  });

  test('deep link to /staff loads correctly', async ({ page }) => {
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 10_000 });
  });
});
