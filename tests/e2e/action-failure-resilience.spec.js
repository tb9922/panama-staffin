/* eslint-disable no-undef -- page.evaluate runs in browser context */
import { expect, test } from '@playwright/test';

const HOME_SLUG = 'e2e-test-home';
const ALICE_ID = 'S001';
const BOB_ID = 'S002';
const ANNUAL_LEAVE_DATE = '2026-04-24';
const DAILY_STATUS_DATE = '2026-03-02';
const ROSTER_OVERRIDE_DATE = '2026-04-20';

async function getCsrfToken(page) {
  return page.evaluate(() => {
    const match = document.cookie.match(/(?:^|;\s*)panama_csrf=([^;]+)/);
    return match ? match[1] : '';
  });
}

async function upsertOverride(page, { date, staffId, shift, al_hours }) {
  const csrfToken = await getCsrfToken(page);
  const response = await page.request.put(
    `http://localhost:3001/api/scheduling/overrides?home=${HOME_SLUG}`,
    {
      headers: { 'X-CSRF-Token': csrfToken },
      data: { date, staffId, shift, ...(al_hours != null ? { al_hours } : {}) },
    },
  );
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function deleteOverrideIfPresent(page, date, staffId) {
  const csrfToken = await getCsrfToken(page);
  await page.request.delete(
    `http://localhost:3001/api/scheduling/overrides?home=${HOME_SLUG}&date=${date}&staffId=${staffId}`,
    { headers: { 'X-CSRF-Token': csrfToken } },
  );
}

test.describe('Action failure resilience', () => {
  test('annual leave cancel failure keeps the page mounted and shows an inline error', async ({ page }) => {
    test.slow();
    await page.goto('/leave', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Annual Leave' })).toBeVisible({ timeout: 30_000 });

    await deleteOverrideIfPresent(page, ANNUAL_LEAVE_DATE, BOB_ID);
    await upsertOverride(page, { date: ANNUAL_LEAVE_DATE, staffId: BOB_ID, shift: 'AL', al_hours: 8 });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const bookingCard = page.locator('div.bg-amber-50').filter({ hasText: 'Bob Jones' }).filter({ hasText: /24 Apr/i }).first();
    await expect(bookingCard).toBeVisible({ timeout: 10_000 });

    await page.route('**/api/scheduling/overrides?home=e2e-test-home&date=2026-04-24&staffId=S002', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Synthetic delete failure' }),
        });
        return;
      }
      await route.continue();
    });

    await bookingCard.getByRole('button', { name: 'Cancel' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Confirm' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByRole('heading', { name: 'Annual Leave' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Some annual leave actions could not be completed')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Unable to load annual leave')).not.toBeVisible();
    await expect(bookingCard).toBeVisible({ timeout: 10_000 });

    await page.unroute('**/api/scheduling/overrides?home=e2e-test-home&date=2026-04-24&staffId=S002');
    await deleteOverrideIfPresent(page, ANNUAL_LEAVE_DATE, BOB_ID);
  });

  test('daily status override failure keeps the page mounted and shows an inline error', async ({ page }) => {
    test.slow();
    await page.goto(`/day/${DAILY_STATUS_DATE}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 30_000 });

    await deleteOverrideIfPresent(page, DAILY_STATUS_DATE, ALICE_ID);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Alice Smith').first()).toBeVisible({ timeout: 30_000 });

    await page.route('**/api/scheduling/overrides?home=e2e-test-home', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Synthetic daily status failure' }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: '+Sick' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mark Sick' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const staffSelect = dialog.locator('select').first();
    await expect(staffSelect.locator(`option[value="${ALICE_ID}"]`)).toHaveCount(1, { timeout: 10_000 });
    await staffSelect.selectOption({ value: ALICE_ID });
    await dialog.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByRole('heading', { name: /Monday,?\s+2 March 2026/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Some daily status actions could not be completed')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Unable to load daily status')).not.toBeVisible();

    await page.unroute('**/api/scheduling/overrides?home=e2e-test-home');
  });

  test('rotation grid revert-all failure keeps the roster mounted and shows an inline error', async ({ page }) => {
    test.slow();
    await page.goto('/rotation', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible({ timeout: 30_000 });

    await deleteOverrideIfPresent(page, ROSTER_OVERRIDE_DATE, BOB_ID);
    await upsertOverride(page, { date: ROSTER_OVERRIDE_DATE, staffId: BOB_ID, shift: 'NS' });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.route('**/api/scheduling/overrides/month?*', async (route) => {
      if (route.request().method() === 'DELETE') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Synthetic month revert failure' }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByRole('button', { name: 'Revert All' }).click();
    const revertDialog = page.getByRole('dialog', { name: 'Revert All Overrides' });
    await expect(revertDialog).toBeVisible({ timeout: 10_000 });
    await revertDialog.getByRole('button', { name: 'Revert All' }).click();
    const confirmDialog = page.getByRole('dialog', { name: 'Confirm' });
    await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
    await confirmDialog.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible({ timeout: 10_000 });
    const inlineError = page.getByRole('alert');
    await expect(inlineError).toContainText('Some roster actions could not be completed', { timeout: 10_000 });
    await expect(page.getByText('Unable to load the roster')).not.toBeVisible();

    await page.unroute('**/api/scheduling/overrides/month?*');
    await deleteOverrideIfPresent(page, ROSTER_OVERRIDE_DATE, BOB_ID);
  });
});
