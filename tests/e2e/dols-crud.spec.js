import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js
// Requires: seed-e2e.js has run (creates 'Test Resident' in finance_residents)
// Workers: 1 — tests run sequentially and share DB state

test.describe('DoLS CRUD', () => {
  test('DoLS Tracker loads with New DoLS/LPS button', async ({ page }) => {
    await page.goto('/dols');
    await expect(page.getByRole('heading', { name: /DoLS/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '+ New DoLS/LPS' })).toBeVisible();
  });

  test('New DoLS/LPS modal opens with correct title', async ({ page }) => {
    await page.goto('/dols');
    await expect(page.getByRole('heading', { name: /DoLS/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '+ New DoLS/LPS' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByText('New DoLS/LPS Application')).toBeVisible();
  });

  test('ResidentPicker in DoLS modal renders as select dropdown', async ({ page }) => {
    await page.goto('/dols');
    await expect(page.getByRole('heading', { name: /DoLS/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '+ New DoLS/LPS' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    // ResidentPicker should render as a <select> when finance:read works for admin
    await expect(modal.locator('option').filter({ hasText: '-- Select resident --' })).toHaveCount(1, { timeout: 5_000 });
    // Confirm the text-input fallback is NOT rendered
    await expect(modal.locator('input[placeholder*="resident" i]')).not.toBeVisible();
  });

  test('submit DoLS form → new row appears in table', async ({ page }) => {
    await page.goto('/dols');
    await expect(page.getByRole('heading', { name: /DoLS/i })).toBeVisible({ timeout: 15_000 });

    const today = new Date().toISOString().split('T')[0];
    // Count cells with today's date in Applied column before adding
    const countBefore = await page.locator('table tbody td').filter({ hasText: today }).count();

    await page.getByRole('button', { name: '+ New DoLS/LPS' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Wait for ResidentPicker to finish loading — Test Resident must appear before selecting
    const residentSelect = modal.locator('select').first();
    const residentOption = residentSelect.locator('option').filter({ hasText: 'Test Resident' });
    await expect(residentOption).toHaveCount(1, { timeout: 10_000 });
    const residentValue = await residentOption.getAttribute('value');
    await residentSelect.selectOption(residentValue);

    // application_date is pre-filled with today — Save button should now be enabled
    const saveBtn = modal.getByRole('button', { name: 'Save' });
    await expect(saveBtn).not.toBeDisabled({ timeout: 3_000 });
    await saveBtn.click();
    // Wait for the page h1 to reappear — DolsTracker shows a loading div during re-fetch
    // (early return unmounts modal+table). .first() avoids strict-mode violation when the
    // modal's "New DoLS/LPS Application" h3 is briefly still in the DOM.
    await expect(page.getByRole('heading', { name: /DoLS/i }).first()).toBeVisible({ timeout: 10_000 });

    // Table should now have one more cell with today's date (retry-friendly assertion)
    await expect(page.locator('table tbody td').filter({ hasText: today })).toHaveCount(countBefore + 1, { timeout: 5_000 });
  });

  test('DoLS record persists after page reload', async ({ page }) => {
    await page.goto('/dols');
    await expect(page.getByRole('heading', { name: /DoLS/i })).toBeVisible({ timeout: 15_000 });

    const today = new Date().toISOString().split('T')[0];
    const countBefore = await page.locator('table tbody td').filter({ hasText: today }).count();
    // Sanity check: previous test created at least one record
    expect(countBefore).toBeGreaterThan(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: /DoLS/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('table tbody td').filter({ hasText: today })).toHaveCount(countBefore);
  });
});
