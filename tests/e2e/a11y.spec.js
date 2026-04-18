import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

async function assertNoBlockingViolations(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);

  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const blockingViolations = scan.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(blockingViolations, JSON.stringify(blockingViolations, null, 2)).toEqual([]);
}

test.describe('Accessibility smoke', () => {
  test('dashboard has no serious or critical axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Today's Coverage/i)).toBeVisible({ timeout: 15_000 });
    await assertNoBlockingViolations(page);
  });

  test('staff database has no serious or critical axe violations', async ({ page }) => {
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 15_000 });
    await assertNoBlockingViolations(page);
  });

  test('residents page has no serious or critical axe violations', async ({ page }) => {
    await page.goto('/residents');
    await expect(page.getByRole('heading', { name: 'Residents' })).toBeVisible({ timeout: 15_000 });
    await assertNoBlockingViolations(page);
  });

  test('annual leave page has no serious or critical axe violations', async ({ page }) => {
    await page.goto('/leave');
    await expect(page.getByRole('heading', { name: 'Annual Leave' })).toBeVisible({ timeout: 15_000 });
    await assertNoBlockingViolations(page);
  });

  test('incidents page has no serious or critical axe violations', async ({ page }) => {
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 15_000 });
    await assertNoBlockingViolations(page);
  });

  test('new incident modal has no serious or critical axe violations', async ({ page }) => {
    await page.goto('/incidents');
    await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /new incident/i }).click();
    await expect(page.getByRole('heading', { name: 'New Incident' })).toBeVisible({ timeout: 10_000 });
    await assertNoBlockingViolations(page);
  });
});
