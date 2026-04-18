import { expect, test } from '@playwright/test';

test.describe('Visual smoke', () => {
  test('staff add modal stays visually stable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /\+ Add Staff/i }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toHaveScreenshot('staff-add-modal.png', {
      animations: 'disabled',
      maxDiffPixels: 100,
    });
  });

  test('daily status fixed-date layout stays visually stable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1400 });
    await page.goto('/day/2026-04-20');
    await expect(page.getByRole('heading', { name: /Monday,?\s+20 April 2026/i })).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('main')).toHaveScreenshot('daily-status-2026-04-20.png', {
      animations: 'disabled',
      maxDiffPixels: 250,
    });
  });
});
