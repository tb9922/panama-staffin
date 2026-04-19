/* eslint-disable no-undef -- page.evaluate runs in browser context */
import { expect, test } from '@playwright/test';

const HOME_SLUG = 'e2e-test-home';
const STAFF_ID = 'S002';

function isoForCurrentMonth(day = 15) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-${String(day).padStart(2, '0')}`;
}

function rowKeyFor(dateStr) {
  return dateStr.slice(5);
}

async function getCsrfToken(page) {
  return page.evaluate(() => {
    const match = document.cookie.match(/(?:^|;\s*)panama_csrf=([^;]+)/);
    return match ? match[1] : '';
  });
}

async function deleteAdjustmentIfPresent(page, dateStr) {
  const csrfToken = await getCsrfToken(page);
  await page.request.delete(
    `http://localhost:3001/api/payroll/timesheets/adjustments?home=${HOME_SLUG}&staff_id=${STAFF_ID}&date=${dateStr}`,
    { headers: { 'X-CSRF-Token': csrfToken } },
  );
}

async function upsertOverride(page, dateStr) {
  const csrfToken = await getCsrfToken(page);
  const response = await page.request.put(
    `http://localhost:3001/api/scheduling/overrides?home=${HOME_SLUG}`,
    {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        date: dateStr,
        staffId: STAFF_ID,
        shift: 'EL',
        source: 'e2e_shortfall',
      },
    },
  );
  expect(response.status(), await response.text()).toBe(200);
}

async function upsertShortfallTimesheet(page, dateStr) {
  const csrfToken = await getCsrfToken(page);
  const response = await page.request.post(
    `http://localhost:3001/api/payroll/timesheets?home=${HOME_SLUG}`,
    {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        staff_id: STAFF_ID,
        date: dateStr,
        scheduled_start: '07:00',
        scheduled_end: '19:00',
        actual_start: '07:00',
        actual_end: '17:30',
        snapped_start: '07:00',
        snapped_end: '17:30',
        break_minutes: 30,
        payable_hours: 10,
        notes: 'E2E shortfall fixture',
      },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
}

test.describe('Monthly Timesheet shortfall resolution', () => {
  test.setTimeout(90_000);

  test('manager can apply and remove both hourly leave and paid-authorised shortfall adjustments', async ({ page }) => {
    const dateStr = isoForCurrentMonth(15);
    const rowKey = rowKeyFor(dateStr);

    await page.goto(`/payroll/monthly-timesheet/${STAFF_ID}`);
    await expect(page.getByRole('heading', { name: 'Monthly Timesheet' })).toBeVisible({ timeout: 15_000 });

    await deleteAdjustmentIfPresent(page, dateStr);
    await upsertOverride(page, dateStr);
    await upsertShortfallTimesheet(page, dateStr);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Monthly Timesheet' })).toBeVisible({ timeout: 15_000 });

    const row = page.locator('tbody tr').filter({ hasText: rowKey }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('td').nth(7)).toHaveText('10.0');
    await expect(row.getByRole('button', { name: 'Adjust' })).toBeVisible();

    await row.getByRole('button', { name: 'Adjust' }).click();
    const dialog = page.getByRole('dialog', { name: 'Resolve Shortfall' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByLabel('Hours to apply').fill('1');
    await dialog.getByLabel('Note').fill('Left early for appointment');
    await dialog.getByRole('button', { name: 'Apply' }).click();

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/hourly annual leave applied to the shortfall/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('td').nth(8)).toContainText('AL');
    await expect(row.locator('td').nth(8)).toContainText('1.0h');
    await expect(row.locator('td').nth(9)).toHaveText('11.0');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Monthly Timesheet' })).toBeVisible({ timeout: 15_000 });
    await expect(row.locator('td').nth(8)).toContainText('AL');
    await expect(row.locator('td').nth(9)).toHaveText('11.0');

    await row.getByRole('button', { name: 'Adjust' }).click();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/hourly adjustment removed/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('td').nth(8)).toHaveText('—');
    await expect(row.locator('td').nth(9)).toHaveText('10.0');

    await row.getByRole('button', { name: 'Adjust' }).click();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByLabel('How should the shortfall be handled?').selectOption('paid_authorised_absence');
    await dialog.getByLabel('Hours to apply').fill('0.5');
    await dialog.getByLabel('Note').fill('Manager approved paid shortfall');
    await dialog.getByRole('button', { name: 'Apply' }).click();

    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/paid authorised absence applied to the shortfall/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('td').nth(8)).toContainText('Paid');
    await expect(row.locator('td').nth(8)).toContainText('0.5h');
    await expect(row.locator('td').nth(9)).toHaveText('10.5');

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Monthly Timesheet' })).toBeVisible({ timeout: 15_000 });
    await expect(row.locator('td').nth(8)).toContainText('Paid');
    await expect(row.locator('td').nth(9)).toHaveText('10.5');

    await row.getByRole('button', { name: 'Adjust' }).click();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await dialog.getByRole('button', { name: 'Remove' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });
    await expect(row.locator('td').nth(8)).toHaveText('—');
    await expect(row.locator('td').nth(9)).toHaveText('10.0');
  });
});
