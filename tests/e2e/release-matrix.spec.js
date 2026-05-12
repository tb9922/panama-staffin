import { expect, test } from '@playwright/test';

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:3001';

const consoleIgnore = [
  /Download the React DevTools/i,
  /ResizeObserver loop/i,
  /Blocked aria-hidden/i,
];

function unique(label) {
  return `E2E Matrix ${label} ${Date.now()}`;
}

function watchProblems(page) {
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (consoleIgnore.some(pattern => pattern.test(text))) return;
    problems.push(`console: ${text}`);
  });
  page.on('response', response => {
    if (!response.url().includes('/api/')) return;
    if (response.status() >= 500) {
      problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  return problems;
}

async function useHome(page, homeSlug, route) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(slug => localStorage.setItem('currentHome', slug), homeSlug);
  await page.goto(route, { waitUntil: 'domcontentloaded' });
}

async function expectHealthy(page, problems, startIndex, label) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await expect(page.locator('main#main-content')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('body')).not.toContainText(/Something went wrong|Page not found|You don't have access|Cannot read properties/i);
  expect(problems.slice(startIndex), `Browser/API problems during ${label}`).toEqual([]);
}

async function expectResponseOk(responsePromise, label) {
  const response = await responsePromise;
  const body = await response.text();
  expect(response.ok(), `${label} failed: ${response.status()} ${body}`).toBeTruthy();
  return body ? JSON.parse(body) : {};
}

test.describe('Release matrix - seeded edge homes', () => {
  test('new empty home can add staff from the UI without losing the home context', async ({ page }) => {
    const problems = watchProblems(page);
    const start = problems.length;
    const staffName = unique('New Staff');

    await useHome(page, 'e2e-empty-home', '/staff');
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('main#main-content').getByText('E2E Empty Home', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /Add Staff/i }).click();

    const dialog = page.getByRole('dialog', { name: 'Add New Staff' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel('Name').fill(staffName);
    await dialog.getByLabel('Start Date').fill('2026-05-01');
    await dialog.getByLabel('Contract hrs/wk').fill('36');

    const createPromise = page.waitForResponse(response =>
      response.url().includes('/api/staff?home=e2e-empty-home') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Add' }).click();
    const created = await expectResponseOk(createPromise, 'staff create on empty home');

    await expect(page.getByRole('dialog', { name: 'Add New Staff' })).not.toBeVisible({ timeout: 10_000 });
    await expect(page.locator('tbody tr').filter({ hasText: staffName })).toBeVisible({ timeout: 10_000 });
    expect(created.id, 'created staff ID should be allocated by the server').toMatch(/^S\d{3}$/);
    await expectHealthy(page, problems, start, 'empty-home staff add');
  });

  test('CQC manual evidence saves on an edge home and rejects bad date order', async ({ page }) => {
    test.setTimeout(120_000);
    const problems = watchProblems(page);
    const start = problems.length;
    const evidenceTitle = unique('CQC Evidence');

    await useHome(page, 'e2e-empty-home', '/cqc');
    await expect(page.getByRole('heading', { name: /CQC/i })).toBeVisible({ timeout: 30_000 });
    await page.locator('[id^="cqc-statement-button-"]').first().click();
    await page.getByRole('button', { name: '+ Add Evidence' }).first().click();

    let dialog = page.getByRole('dialog', { name: 'Add Evidence Item' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel('Quality Statement').selectOption('S1');
    await dialog.getByLabel('Title').fill(evidenceTitle);
    await dialog.getByLabel('Description', { exact: true }).fill('Release matrix proof that manual evidence can be saved.');
    await dialog.getByLabel('Evidence From').fill('2026-05-10');
    await dialog.getByLabel('Evidence To (optional)').fill('2026-05-01');
    await dialog.getByRole('button', { name: 'Save Evidence' }).click();
    await expect(dialog.getByText('Evidence To cannot be before Evidence From.')).toBeVisible({ timeout: 10_000 });

    await dialog.getByLabel('Evidence To (optional)').fill('2026-05-31');
    const savePromise = page.waitForResponse(response =>
      response.url().includes('/api/cqc-evidence?home=e2e-empty-home') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Save Evidence' }).click();
    const saved = await expectResponseOk(savePromise, 'CQC evidence save');

    expect(saved.title).toBe(evidenceTitle);
    dialog = page.getByRole('dialog', { name: 'Edit Evidence Item' });
    await expect(dialog.getByText(/Evidence saved/i)).toBeVisible({ timeout: 10_000 });
    await dialog.locator('button').filter({ hasText: 'Close' }).click();
    await expect(page.getByText(evidenceTitle)).toBeVisible({ timeout: 10_000 });
    await expectHealthy(page, problems, start, 'CQC evidence save');
  });

  test('release-matrix homes are visible through portfolio KPIs', async ({ page }) => {
    const response = await page.request.get(`${API_BASE}/api/portfolio/kpis`);
    const body = await response.text();
    expect(response.ok(), `portfolio KPIs failed: ${response.status()} ${body}`).toBeTruthy();
    const data = JSON.parse(body);
    const slugs = data.homes.map(home => home.home_slug);
    expect(slugs).toEqual(expect.arrayContaining([
      'e2e-empty-home',
      'e2e-normal-home',
      'e2e-messy-home',
    ]));
  });
});
