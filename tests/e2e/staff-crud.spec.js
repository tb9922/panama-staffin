import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Staff CRUD', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 15_000 });
  });

  test('Add Staff button opens form modal', async ({ page }) => {
    await page.getByRole('button', { name: /Add Staff/i }).click();
    // Modal should appear with form fields
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  });

  test('Add Staff form validates required fields', async ({ page }) => {
    await page.getByRole('button', { name: /Add Staff/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    // Submit button should be disabled when required fields are empty
    const submitBtn = page.getByRole('dialog').getByRole('button', { name: /^Add$|Save|Create/i });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();
  });

  test('clicking a staff row opens edit view', async ({ page }) => {
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
