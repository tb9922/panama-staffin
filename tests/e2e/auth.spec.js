import { test, expect } from '@playwright/test';

// These tests do NOT use the pre-authenticated state — they test the login flow itself.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Authentication', () => {
  test('login with valid credentials shows dashboard', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Enter username').fill('admin');
    await page.getByPlaceholder('Enter password').fill('admin123');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15_000 });
  });

  test('login with wrong password shows error', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('Enter username').fill('admin');
    await page.getByPlaceholder('Enter password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.getByText('Invalid username or password')).toBeVisible();
  });

  test('unauthenticated visit shows login screen', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByPlaceholder('Enter username')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('page refresh preserves session', async ({ page }) => {
    // Login first
    await page.goto('/');
    await page.getByPlaceholder('Enter username').fill('admin');
    await page.getByPlaceholder('Enter password').fill('admin123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15_000 });

    // Refresh
    await page.reload();

    // Should still be on dashboard, not login
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByPlaceholder('Enter username')).not.toBeVisible();
  });

  test('logout returns to login screen', async ({ page }) => {
    // Login first
    await page.goto('/');
    await page.getByPlaceholder('Enter username').fill('admin');
    await page.getByPlaceholder('Enter password').fill('admin123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 15_000 });

    // Click logout
    await page.getByRole('button', { name: 'Logout' }).click();

    // Should see login screen
    await expect(page.getByPlaceholder('Enter username')).toBeVisible();
  });
});
