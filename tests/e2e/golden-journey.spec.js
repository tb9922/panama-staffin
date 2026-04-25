import { expect, test } from '@playwright/test';

const routeChecks = [
  { path: '/', ready: async page => expect(page.getByRole('heading', { name: 'E2E Test Home' })).toBeVisible({ timeout: 30_000 }) },
  { path: '/day/2026-03-02', ready: async page => expect(page.getByRole('heading', { name: /Monday,?\s+2 March 2026/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/rotation', ready: async page => expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible({ timeout: 30_000 }) },
  { path: '/leave', ready: async page => expect(page.getByRole('heading', { name: 'Annual Leave' })).toBeVisible({ timeout: 30_000 }) },
  { path: '/staff', ready: async page => expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 30_000 }) },
  { path: '/training', ready: async page => expect(page.getByRole('heading', { name: /Training/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/incidents', ready: async page => expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/cqc', ready: async page => expect(page.getByRole('heading', { name: /CQC/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/dols', ready: async page => expect(page.getByRole('heading', { name: /DoLS|LPS/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/risks', ready: async page => expect(page.getByRole('heading', { name: 'Risk Register' })).toBeVisible({ timeout: 30_000 }) },
  { path: '/hr', ready: async page => expect(page.getByRole('heading', { name: /HR/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/hr/absence', ready: async page => expect(page.getByRole('heading', { name: /Absence/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/hr/edi', ready: async page => expect(page.getByRole('heading', { name: 'Equality, Diversity & Inclusion' })).toBeVisible({ timeout: 30_000 }) },
  { path: '/hr/tupe', ready: async page => expect(page.getByRole('heading', { name: /TUPE/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/hr/renewals', ready: async page => expect(page.getByRole('heading', { name: /DBS|RTW|Right to Work/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/finance', ready: async page => expect(page.getByRole('heading', { name: /Finance/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/residents', ready: async page => expect(page.getByRole('heading', { name: 'Residents' })).toBeVisible({ timeout: 30_000 }) },
  { path: '/payroll', ready: async page => expect(page.getByRole('heading', { name: /Payroll Runs/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/payroll/timesheets', ready: async page => expect(page.getByRole('heading', { name: /Timesheets/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/gdpr', ready: async page => expect(page.getByRole('heading', { name: 'GDPR & Data Protection' })).toBeVisible({ timeout: 30_000 }) },
  { path: '/evidence', ready: async page => expect(page.getByRole('heading', { name: 'Evidence Hub' })).toBeVisible({ timeout: 30_000 }) },
  { path: '/users', ready: async page => expect(page.getByRole('heading', { name: /User Management/i })).toBeVisible({ timeout: 30_000 }) },
  { path: '/platform/homes', ready: async page => expect(page.getByRole('heading', { name: /Manage Homes/i })).toBeVisible({ timeout: 30_000 }) },
];

const consoleIgnore = [
  /Download the React DevTools/i,
  /ResizeObserver loop/i,
];

function watchBrowserProblems(page) {
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (consoleIgnore.some(pattern => pattern.test(text))) return;
    problems.push(`console: ${text}`);
  });
  return problems;
}

async function expectHealthyShell(page, path, problems, problemStart) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(100);
  await expect(page.locator('main#main-content')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('body')).not.toContainText(/Something went wrong|Error loading data|Unable to load staffing data|Page not found|You don't have access/i);
  const newProblems = problems.slice(problemStart);
  expect(newProblems, `Browser errors while loading ${path}`).toEqual([]);
}

test.describe('Golden dashboard journey', () => {
  test('admin can load every release-critical dashboard route without client errors', async ({ page }) => {
    test.setTimeout(180_000);
    const problems = watchBrowserProblems(page);

    for (const check of routeChecks) {
      await test.step(`load ${check.path}`, async () => {
        const problemStart = problems.length;
        await page.goto(check.path, { waitUntil: 'domcontentloaded' });
        await check.ready(page);
        await expectHealthyShell(page, check.path, problems, problemStart);
      });
    }
  });

  test('critical write surfaces open and close without saving data', async ({ page }) => {
    test.setTimeout(120_000);
    const problems = watchBrowserProblems(page);

    await test.step('incident modal', async () => {
      const problemStart = problems.length;
      await page.goto('/incidents', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /Incident/i })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: '+ New Incident' }).click();
      await expect(page.getByRole('dialog', { name: 'New Incident' })).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'New Incident' })).not.toBeVisible({ timeout: 10_000 });
      await expectHealthyShell(page, '/incidents', problems, problemStart);
    });

    await test.step('staff modal', async () => {
      const problemStart = problems.length;
      await page.goto('/staff', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: '+ Add Staff' }).click();
      await expect(page.getByRole('dialog', { name: 'Add New Staff' })).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Add New Staff' })).not.toBeVisible({ timeout: 10_000 });
      await expectHealthyShell(page, '/staff', problems, problemStart);
    });

    await test.step('GDPR request modal', async () => {
      const problemStart = problems.length;
      await page.goto('/gdpr', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'GDPR & Data Protection' })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('tab', { name: 'Data Requests' }).click();
      await expect(page.getByRole('heading', { name: 'Data Requests' })).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'New Request' }).click();
      await expect(page.getByRole('dialog', { name: 'New Data Request' })).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'New Data Request' })).not.toBeVisible({ timeout: 10_000 });
      await expectHealthyShell(page, '/gdpr', problems, problemStart);
    });

    await test.step('user management modal', async () => {
      const problemStart = problems.length;
      await page.goto('/users', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: /User Management/i })).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Add User' }).click();
      await expect(page.getByRole('dialog', { name: 'Add User' })).toBeVisible({ timeout: 10_000 });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Add User' })).not.toBeVisible({ timeout: 10_000 });
      await expectHealthyShell(page, '/users', problems, problemStart);
    });
  });
});
