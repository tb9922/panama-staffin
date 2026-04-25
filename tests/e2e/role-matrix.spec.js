import { expect, test } from '@playwright/test';

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3001';
const HOME = 'e2e-test-home';

async function expectDashboard(page) {
  await expect(page.getByRole('heading', { name: 'E2E Test Home' })).toBeVisible({ timeout: 30_000 });
}

async function expectRouteAllowed(page, path, ready) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}(?:$|[?#])`));
}

async function expectRouteRedirectsHome(page, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expectDashboard(page);
  await expect(page).toHaveURL(/\/(?:$|[?#])/);
}

async function expectApiStatus(page, path, status) {
  const response = await page.request.get(`${API_BASE}${path}`);
  expect(response.status(), `${path} should return ${status}; body: ${await response.text()}`).toBe(status);
}

test.describe('Role matrix - platform admin', () => {
  test('platform admin can use platform and regulated modules', async ({ page }) => {
    await expectRouteAllowed(page, '/platform/homes', async p => {
      await expect(p.getByRole('heading', { name: /Manage Homes/i })).toBeVisible({ timeout: 30_000 });
    });
    await expectRouteAllowed(page, '/audit', async p => {
      await expect(p.getByRole('heading', { name: /Audit/i })).toBeVisible({ timeout: 30_000 });
    });
    await expectRouteAllowed(page, '/hr/absence', async p => {
      await expect(p.getByRole('heading', { name: /Absence/i })).toBeVisible({ timeout: 30_000 });
    });
    await expectApiStatus(page, `/api/hr/stats?home=${HOME}`, 200);
    await expectApiStatus(page, `/api/gdpr/access-log?home=${HOME}`, 200);
  });
});

test.describe('Role matrix - home manager', () => {
  test.use({ storageState: '.playwright/manager-state.json' });

  test('home manager gets home-level admin tools but not platform-only screens', async ({ page }) => {
    await expectRouteAllowed(page, '/users', async p => {
      await expect(p.getByRole('heading', { name: /User Management/i })).toBeVisible({ timeout: 30_000 });
    });
    await expectRouteAllowed(page, '/hr/absence', async p => {
      await expect(p.getByRole('heading', { name: /Absence/i })).toBeVisible({ timeout: 30_000 });
    });
    await expectRouteRedirectsHome(page, '/audit');
    await expectRouteRedirectsHome(page, '/platform/homes');
    await expectApiStatus(page, `/api/hr/stats?home=${HOME}`, 200);
    await expectApiStatus(page, `/api/gdpr/access-log?home=${HOME}`, 200);
  });
});

test.describe('Role matrix - shift coordinator', () => {
  test.use({ storageState: '.playwright/coordinator-state.json' });

  test('shift coordinator can operate scheduling and read staff but cannot reach sensitive modules', async ({ page }) => {
    await expectRouteAllowed(page, '/day/2026-03-02', async p => {
      await expect(p.getByRole('heading', { name: /Monday,?\s+2 March 2026/i })).toBeVisible({ timeout: 30_000 });
    });
    await expectRouteAllowed(page, '/staff', async p => {
      await expect(p.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 30_000 });
    });
    await expectRouteRedirectsHome(page, '/incidents');
    await expectRouteRedirectsHome(page, '/hr/absence');
    await expectRouteRedirectsHome(page, '/finance');
    await expectRouteRedirectsHome(page, '/gdpr');
    await expectRouteRedirectsHome(page, '/users');
    await expectApiStatus(page, `/api/hr/stats?home=${HOME}`, 403);
    await expectApiStatus(page, `/api/incidents?home=${HOME}`, 403);
    await expectApiStatus(page, `/api/gdpr/access-log?home=${HOME}`, 403);
  });
});

test.describe('Role matrix - viewer', () => {
  test.use({ storageState: '.playwright/viewer-state.json' });

  test('viewer keeps read-only operational access and no mutation controls', async ({ page }) => {
    await expectRouteAllowed(page, '/staff', async p => {
      await expect(p.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 30_000 });
    });
    await expect(page.getByRole('button', { name: /Add Staff/i })).not.toBeVisible();
    await expectRouteAllowed(page, '/reports', async p => {
      await expect(p.getByRole('heading', { name: /Report/i }).first()).toBeVisible({ timeout: 30_000 });
    });
    await expectRouteRedirectsHome(page, '/incidents');
    await expectRouteRedirectsHome(page, '/hr');
    await expectRouteRedirectsHome(page, '/finance');
    await expectRouteRedirectsHome(page, '/gdpr');
    await expectApiStatus(page, `/api/hr/stats?home=${HOME}`, 403);
    await expectApiStatus(page, `/api/incidents?home=${HOME}`, 403);
    await expectApiStatus(page, `/api/gdpr/access-log?home=${HOME}`, 403);
  });
});
