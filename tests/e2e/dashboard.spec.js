import { test, expect } from '@playwright/test';

// Uses pre-authenticated admin state from auth.setup.js

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders home header', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'E2E Test Home' })).toBeVisible({ timeout: 15_000 });
  });

  test('shows coverage section', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Today's Coverage/i })).toBeVisible({ timeout: 15_000 });
  });

  test('shows staffing summary', async ({ page }) => {
    await expect(page.getByText(/Staffing Summary/i)).toBeVisible({ timeout: 15_000 });
  });

  test('sidebar navigation is visible', async ({ page }) => {
    const sidebar = page.locator('aside[aria-label="Main navigation"]');
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 15_000 });
    // Check nav group buttons exist in sidebar
    await expect(sidebar.getByRole('button', { name: /^Scheduling(?:\s+\d+)?$/ })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /^Staff(?:\s+\d+)?$/ })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /^Compliance(?:\s+\d+)?$/ })).toBeVisible();
  });
});
