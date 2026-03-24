/* eslint-disable no-undef -- page.evaluate runs in browser context */
import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js
// Workers: 1 — tests run sequentially and share DB state
//
// Cycle maths for test date 2026-03-02 (seed cycle_start_date = 2025-01-06):
//   days elapsed = 365 + 55 = 420 → 420 % 14 = 0 → cycleDay 0
//   Pattern A [1,1,0,0,1,1,1,0,0,1,1,0,0,0] — A[0] = 1
//   → Alice Smith (S001, Day A) is on an Early shift on 2026-03-02

const TEST_DATE = '2026-03-02';
const ALICE_ID = 'S001';

test.describe('Scheduling — Daily Status', () => {
  test('Daily Status loads for today with staff table', async ({ page }) => {
    const today = new Date().toISOString().split('T')[0];
    await page.goto(`/day/${today}`);
    await expect(page.getByText(/early/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('table')).toBeVisible({ timeout: 5_000 });
  });

  test('+Sick button is visible on Daily Status', async ({ page }) => {
    const today = new Date().toISOString().split('T')[0];
    await page.goto(`/day/${today}`);
    await expect(page.getByText(/early/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '+Sick' })).toBeVisible();
  });

  test('+Sick button opens Mark Sick modal', async ({ page }) => {
    const today = new Date().toISOString().split('T')[0];
    await page.goto(`/day/${today}`);
    await expect(page.getByText(/early/i).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '+Sick' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByText('Mark Sick')).toBeVisible();
    // Staff selector is always present (may be empty if no working staff today)
    await expect(modal.locator('select')).toBeVisible();
  });

  test('SICK override applied and confirmed on known-working date', async ({ page }) => {
    // Navigate first so the page's auth context is active, then clean up
    await page.goto(`/day/${TEST_DATE}`);
    await expect(page.getByText(/early/i).first()).toBeVisible({ timeout: 15_000 });

    // Delete any pre-existing override.
    // Must include X-CSRF-Token — the server uses CSRF double-submit for mutating requests.
    // panama_csrf is a JS-readable cookie; panama_token is HttpOnly and auto-sent.
    const csrfToken = await page.evaluate(() => {
      const m = document.cookie.match(/(?:^|;\s*)panama_csrf=([^;]+)/);
      return m ? m[1] : '';
    });
    await page.request.delete(
      `http://localhost:3001/api/scheduling/overrides?home=e2e-test-home&date=${TEST_DATE}&staffId=${ALICE_ID}`,
      { headers: { 'X-CSRF-Token': csrfToken } },
    );

    // Reload to get fresh data without the stale override
    await page.reload();
    await expect(page.getByText(/early/i).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: '+Sick' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Alice (S001) should be in the select — she is on an Early shift on this date
    const staffSelect = modal.locator('select').first();
    await expect(staffSelect.locator(`option[value="${ALICE_ID}"]`)).toHaveCount(1, { timeout: 5_000 });
    await staffSelect.selectOption({ value: ALICE_ID });

    await modal.getByRole('button', { name: 'Confirm' }).click();
    await expect(modal).not.toBeVisible({ timeout: 10_000 });

    // Alice's row should now show SICK shift code
    await expect(page.getByText('SICK', { exact: true })).toBeVisible({ timeout: 5_000 });
  });

  test('SICK override persists after page reload', async ({ page }) => {
    await page.goto(`/day/${TEST_DATE}`);
    await expect(page.getByText(/early/i).first()).toBeVisible({ timeout: 15_000 });
    // SICK was applied in the previous test — it must survive a reload
    await expect(page.getByText('SICK', { exact: true })).toBeVisible({ timeout: 5_000 });

    await page.reload();
    await expect(page.getByText(/early/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('SICK', { exact: true })).toBeVisible({ timeout: 5_000 });
  });
});
