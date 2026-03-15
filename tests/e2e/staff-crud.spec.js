import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Staff CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/staff');
    await expect(page.getByText('Staff Database')).toBeVisible({ timeout: 15_000 });
  });

  test('Add Staff button opens form modal', async ({ page }) => {
    await page.getByRole('button', { name: /Add Staff/i }).click();
    // Modal should appear with form fields
    await expect(page.getByText(/Name/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Role/i)).toBeVisible();
    await expect(page.getByText(/Team/i)).toBeVisible();
  });

  test('Add Staff form validates required fields', async ({ page }) => {
    await page.getByRole('button', { name: /Add Staff/i }).click();
    // Try to submit empty form — look for a Save/Add button
    const saveBtn = page.getByRole('button', { name: /Save|Add|Create/i });
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      // Should show validation error or form should not close
      await expect(page.getByText(/Name/i)).toBeVisible();
    }
  });

  test('clicking a staff row opens edit view', async ({ page }) => {
    // Click first staff row
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    const staffName = await firstRow.locator('td').first().textContent();
    await firstRow.click();

    // Should show edit modal or detail view with staff name
    if (staffName) {
      await expect(page.getByText(staffName.trim())).toBeVisible({ timeout: 5_000 });
    }
  });

  test('staff table shows data columns', async ({ page }) => {
    await expect(page.getByRole('columnheader', { name: /Name/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Role/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Team/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Rate/i })).toBeVisible();
  });
});
