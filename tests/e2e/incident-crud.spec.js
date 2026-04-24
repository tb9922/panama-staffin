import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js
// Requires: seed-e2e.js has run (creates 'Test Resident' in finance_residents)
// Workers: 1 — tests run sequentially and share DB state

test.describe('Incident CRUD', () => {
  let createdIncidentDate;

  test('Incident Tracker loads with New Incident button', async ({ page }) => {
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '+ New Incident' })).toBeVisible();
  });

  test('New Incident modal opens with date pre-filled', async ({ page }) => {
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '+ New Incident' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    // Date field should be pre-filled with today's date
    const dateInput = modal.locator('input[type="date"]').first();
    await expect(dateInput).not.toHaveValue('');
  });

  test('ResidentPicker renders as select dropdown (not free-text input)', async ({ page }) => {
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '+ New Incident' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    // person_affected defaults to 'resident', so ResidentPicker is visible
    // When finance:read access works, ResidentPicker shows a <select> with placeholder option
    // If it fell back to a text input, admin's finance:read access is broken
    await expect(modal.locator('option').filter({ hasText: '-- Select resident --' })).toHaveCount(1, { timeout: 5_000 });
    // Confirm the text-input fallback is NOT rendered
    await expect(modal.locator('input[placeholder*="resident" i]')).not.toBeVisible();
  });

  test('submit incident form → new row appears in table', async ({ page }) => {
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: '+ New Incident' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    createdIncidentDate = await modal.locator('input[type="date"]').first().inputValue();

    // Count cells containing the pre-filled incident date before adding (empty-state row won't match)
    const countBefore = await page.locator('table tbody td').filter({ hasText: createdIncidentDate }).count();

    // Select incident type — second select in the modal (Location=0, IncidentType=1)
    const typeSelect = modal.locator('select').nth(1);
    await typeSelect.selectOption({ index: 1 });

    // Date pre-filled, severity already 'minor' — form is valid
    const saveBtn = modal.getByRole('button', { name: 'Save' });
    await expect(saveBtn).not.toBeDisabled({ timeout: 3_000 });
    await saveBtn.click();
    // Wait for the page h1 to reappear — IncidentTracker shows a loading div while
    // re-fetching (early return unmounts modal+table). .first() avoids strict-mode
    // violation when the modal's "New Incident" h3 is briefly still in the DOM.
    await expect(page.getByRole('heading', { name: /Incident/i }).first()).toBeVisible({ timeout: 10_000 });

    // Table should now have one more cell with the created incident date (retry-friendly assertion)
    await expect(page.locator('table tbody td').filter({ hasText: createdIncidentDate })).toHaveCount(countBefore + 1, { timeout: 5_000 });
  });

  test('incident persists after page reload', async ({ page }) => {
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 15_000 });

    const incidentDate = createdIncidentDate || await page.locator('table tbody td').first().textContent();
    const countBefore = await page.locator('table tbody td').filter({ hasText: incidentDate }).count();
    // Sanity check: previous test created at least one incident
    expect(countBefore).toBeGreaterThan(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('table tbody td').filter({ hasText: incidentDate })).toHaveCount(countBefore);
  });
});
