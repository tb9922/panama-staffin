import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
  });

  test('navigate to Roster via sidebar', async ({ page }) => {
    // Scheduling section may already be expanded; click link directly if visible
    const rosterLink = page.getByRole('link', { name: 'Roster' });
    if (!(await rosterLink.isVisible())) {
      await page.getByRole('button', { name: 'Scheduling' }).click();
    }
    await rosterLink.click();
    await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to Staff Database via sidebar', async ({ page }) => {
    const staffLink = page.getByRole('link', { name: 'Staff Database' });
    if (!(await staffLink.isVisible())) {
      await page.getByRole('button', { name: /^Staff$/ }).click();
    }
    await staffLink.click();
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to Training via sidebar', async ({ page }) => {
    const trainingLink = page.getByRole('link', { name: 'Training' });
    if (!(await trainingLink.isVisible())) {
      await page.getByRole('button', { name: /^Staff$/ }).click();
    }
    await trainingLink.click();
    await expect(page.getByRole('heading', { name: /Training/i })).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to Incidents via sidebar', async ({ page }) => {
    const incidentsLink = page.getByRole('link', { name: 'Incidents' });
    if (!(await incidentsLink.isVisible())) {
      await page.getByRole('button', { name: 'Compliance' }).click();
    }
    await incidentsLink.click();
    await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 10_000 });
  });

  test('navigate to CQC Evidence via sidebar', async ({ page }) => {
    const cqcLink = page.getByRole('link', { name: 'CQC Evidence' });
    if (!(await cqcLink.isVisible())) {
      await page.getByRole('button', { name: 'Compliance' }).click();
    }
    await cqcLink.click();
    await expect(page.getByRole('heading', { name: /CQC/i })).toBeVisible({ timeout: 10_000 });
  });

  test('deep link to /staff loads correctly', async ({ page }) => {
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 10_000 });
  });
});
