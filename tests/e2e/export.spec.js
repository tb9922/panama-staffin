import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Excel & PDF Exports', () => {
  test('Audit Log export triggers download', async ({ page }) => {
    await page.goto('/audit');
    await expect(page.getByRole('heading', { name: /Audit/i })).toBeVisible({ timeout: 15_000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
    await page.getByRole('button', { name: /Export|Download/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
  });

  test('CQC Evidence PDF generation triggers download', async ({ page }) => {
    await page.goto('/cqc');
    await expect(page.getByRole('heading', { name: /CQC/i })).toBeVisible({ timeout: 15_000 });

    const pdfBtn = page.getByRole('button', { name: /PDF|Generate|Download|Pack/i });
    if (await pdfBtn.isVisible()) {
      const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
      await pdfBtn.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.(pdf|xlsx)$/);
    }
  });

  test('Reports page loads with export options', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: /Report/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Generate|Export|Download|PDF/i })).toBeVisible();
  });
});
