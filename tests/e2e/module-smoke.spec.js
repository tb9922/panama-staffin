/* eslint-disable no-undef -- page.evaluate runs in browser context */
import { expect, test } from '@playwright/test';

const HOME_SLUG = 'e2e-test-home';
const BOB_ID = 'S002';
const NO_SHOW_DATE = '2026-04-20'; // cycleDay 7 -> Bob (Day B) is working
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3001';
const CYCLE_START = Date.UTC(2025, 0, 6);
const BOB_WORKING_CYCLE_DAYS = new Set([2, 3, 7, 8, 11, 12, 13]);
const LEAVE_DATE = nextBobWorkingDate();

function nextBobWorkingDate() {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 1);
  for (let i = 0; i < 90; i += 1) {
    const cycleDay = Math.floor((date.getTime() - CYCLE_START) / 86_400_000) % 14;
    if (BOB_WORKING_CYCLE_DAYS.has(cycleDay)) return date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 1);
  }
  throw new Error('Unable to find a future Bob working date');
}

function dayMonthRegex(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const day = date.getUTCDate();
  const month = date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return new RegExp(`${day}\\s+${month}`, 'i');
}

async function getCsrfToken(page) {
  return page.evaluate(() => {
    const match = document.cookie.match(/(?:^|;\s*)panama_csrf=([^;]+)/);
    return match ? match[1] : '';
  });
}

async function deleteOverrideIfPresent(page, date, staffId) {
  const csrfToken = await getCsrfToken(page);
  await page.request.delete(
    `${API_BASE}/api/scheduling/overrides?home=${HOME_SLUG}&date=${date}&staffId=${staffId}`,
    { headers: { 'X-CSRF-Token': csrfToken } },
  );
}

test.describe('Module smoke', () => {
  test('annual leave booking shows success and persists the new booking', async ({ page }) => {
    await page.goto('/leave');
    await expect(page.getByText(/Loading annual leave/i)).not.toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Book Annual Leave' })).toBeVisible({ timeout: 15_000 });

    await deleteOverrideIfPresent(page, LEAVE_DATE, BOB_ID);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Annual Leave' })).toBeVisible({ timeout: 15_000 });

    await page.locator(`#annual-leave-book-staff`).selectOption(BOB_ID);
    await page.locator(`#annual-leave-book-start`).fill(LEAVE_DATE);
    await page.locator(`#annual-leave-book-end`).fill(LEAVE_DATE);
    await page.getByRole('button', { name: 'Book Annual Leave' }).click();

    await expect(page.getByText(/1 AL days booked \([\d.]+h\)/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Saving...')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('No upcoming AL bookings')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(dayMonthRegex(LEAVE_DATE))).toBeVisible({ timeout: 10_000 });
    const coverPlanDialog = page.getByRole('dialog', { name: /Cover Plan/i });
    if (await coverPlanDialog.isVisible().catch(() => false)) {
      await coverPlanDialog.getByRole('button', { name: 'Dismiss' }).click();
      await expect(coverPlanDialog).not.toBeVisible({ timeout: 10_000 });
    }

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Annual Leave' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(dayMonthRegex(LEAVE_DATE))).toBeVisible({ timeout: 10_000 });

    await deleteOverrideIfPresent(page, LEAVE_DATE, BOB_ID);
  });

  test('staff invite golden path opens a shareable invite link', async ({ page }) => {
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 15_000 });

    const aliceRow = page.locator('tbody tr').filter({ hasText: 'Alice Smith' }).first();
    await expect(aliceRow).toBeVisible({ timeout: 10_000 });
    const inviteResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/staff-auth/invite?home=e2e-test-home') && response.request().method() === 'POST');
    await aliceRow.getByRole('button', { name: 'Invite' }).click();
    const inviteResponse = await inviteResponsePromise;
    const inviteResponseText = await inviteResponse.text();
    expect(inviteResponse.status(), inviteResponseText).toBe(201);

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText(/Portal Invite for Alice Smith/i)).toBeVisible();
    await expect(dialog.locator('#staff-invite-url')).toHaveValue(/\/staff\/setup\?token=/);
    await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect(dialog.getByLabel('Close')).toBeVisible();
  });

  test('daily status no-show flow shows the absence and survives reload', async ({ page }) => {
    await page.goto(`/day/${NO_SHOW_DATE}`);
    await expect(page.getByRole('heading', { name: /Monday,?\s+20 April 2026/i })).toBeVisible({ timeout: 15_000 });

    await deleteOverrideIfPresent(page, NO_SHOW_DATE, BOB_ID);
    await page.reload();
    await expect(page.getByRole('heading', { name: /Monday,?\s+20 April 2026/i })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: '+No Show' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.locator('select').first().selectOption({ value: BOB_ID });
    const overrideResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/scheduling/overrides?home=e2e-test-home') && response.request().method() === 'PUT');
    await dialog.getByRole('button', { name: 'Confirm' }).click();
    const overrideResponse = await overrideResponsePromise;
    const overrideBody = await overrideResponse.text();
    expect(overrideResponse.status(), overrideBody).toBe(200);

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('NS', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/marked as no-show/i).first()).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole('heading', { name: /Monday,?\s+20 April 2026/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('NS', { exact: true })).toBeVisible({ timeout: 10_000 });

    await deleteOverrideIfPresent(page, NO_SHOW_DATE, BOB_ID);
  });
});
