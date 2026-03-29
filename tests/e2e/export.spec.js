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

  test('approved payroll run summary PDF endpoint returns a PDF in browser context', async ({ page }) => {
    await page.goto('/payroll');
    await expect(page.getByRole('heading', { name: /Payroll Runs/i })).toBeVisible({ timeout: 15_000 });

    const pdfInfo = await page.evaluate(async () => {
      const home = localStorage.getItem('currentHome');
      const runsRes = await fetch(`/api/payroll/runs?home=${home}`, { credentials: 'include' });
      const payload = await runsRes.json();
      const runs = Array.isArray(payload) ? payload : (payload.rows || []);
      const approved = runs.find((run) => ['approved', 'exported', 'locked'].includes(run.status));
      if (!approved) throw new Error('No approved payroll run available for PDF smoke test');

      const pdfRes = await fetch(`/api/payroll/runs/${approved.id}/summary-pdf?home=${home}`, {
        credentials: 'include',
      });
      const blob = await pdfRes.blob();
      return {
        status: pdfRes.status,
        contentType: blob.type,
        size: blob.size,
      };
    });

    expect(pdfInfo.status).toBe(200);
    expect(pdfInfo.contentType).toContain('pdf');
    expect(pdfInfo.size).toBeGreaterThan(0);
  });
});
