import { expect, test } from '@playwright/test';

const HOME = 'e2e-test-home';
const API_HOME = `home=${HOME}`;

function unique(label) {
  return `E2E V1 ${label} ${Date.now()}`;
}

async function expectApiOk(responsePromise, label) {
  const response = await responsePromise;
  const body = await response.text();
  expect(response.ok(), `${label} failed: ${response.status()} ${body}`).toBeTruthy();
  return body ? JSON.parse(body) : {};
}

test.describe('V1 operating-system UX', () => {
  test('portfolio dashboard renders three homes and generates board-pack data', async ({ page }) => {
    await page.goto('/portfolio');
    await expect(page.getByRole('heading', { name: 'Portfolio Dashboard' })).toBeVisible({ timeout: 30_000 });
    const main = page.locator('main#main-content');
    await expect(main.getByText('E2E Test Home', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(main.getByText('E2E Portfolio Amber', { exact: true }).first()).toBeVisible();
    await expect(main.getByText('E2E Portfolio Red', { exact: true }).first()).toBeVisible();

    const boardPackPromise = page.waitForResponse(response =>
      response.url().includes('/api/portfolio/board-pack') && response.request().method() === 'GET');
    await page.getByRole('button', { name: 'Board Pack PDF' }).click();
    const pack = await expectApiOk(boardPackPromise, 'board pack');

    expect(pack.homes.length).toBeGreaterThanOrEqual(3);
    expect(pack.homes.map(home => home.home_slug)).toEqual(expect.arrayContaining([
      'e2e-test-home',
      'e2e-portfolio-amber',
      'e2e-portfolio-red',
    ]));
    await expect(page.locator('body')).not.toContainText(/Failed to generate portfolio board pack/i);
  });

  test('manager action can be created, completed and verified from the UI', async ({ page }) => {
    const title = unique('manager action');
    await page.goto('/actions');
    await expect(page.getByRole('heading', { name: 'Manager Actions' })).toBeVisible({ timeout: 30_000 });

    await page.locator('main#main-content').getByRole('button', { name: 'New Action' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New Action' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Due date').fill('2026-05-15');
    await dialog.getByLabel('Owner', { exact: true }).fill('E2E Manager');
    await dialog.getByLabel('Evidence required').check();

    const createPromise = page.waitForResponse(response =>
      response.url().includes(`/api/action-items?${API_HOME}`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expectApiOk(createPromise, 'create action');
    await expect(page.getByRole('dialog', { name: 'New Action' })).not.toBeVisible({ timeout: 10_000 });

    let row = page.locator('tbody tr').filter({ hasText: title }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const completePromise = page.waitForResponse(response =>
      response.url().includes('/api/action-items/') && response.url().includes('/complete') && response.request().method() === 'POST');
    await row.getByRole('button', { name: 'Complete' }).click();
    await expectApiOk(completePromise, 'complete action');

    row = page.locator('tbody tr').filter({ hasText: title }).first();
    await expect(row.getByText('Completed')).toBeVisible({ timeout: 10_000 });

    const verifyPromise = page.waitForResponse(response =>
      response.url().includes('/api/action-items/') && response.url().includes('/verify') && response.request().method() === 'POST');
    await row.getByRole('button', { name: 'Verify' }).click();
    await expectApiOk(verifyPromise, 'verify action');
    await expect(page.locator('tbody tr').filter({ hasText: title }).first().getByText('Verified')).toBeVisible({ timeout: 10_000 });
  });

  test('audit calendar, outcomes and reflective practice core forms save', async ({ page }) => {
    const auditTitle = unique('audit task');
    await page.goto('/audit-calendar');
    await expect(page.getByRole('heading', { name: 'Audit Calendar' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'New Task' }).click();
    let dialog = page.getByRole('dialog', { name: 'New Audit Task' });
    await dialog.getByLabel('Title').fill(auditTitle);
    await dialog.getByLabel('Due date').fill('2026-05-16');
    const auditPromise = page.waitForResponse(response =>
      response.url().includes(`/api/audit-tasks?${API_HOME}`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expectApiOk(auditPromise, 'create audit task');
    let auditRow = page.locator('tbody tr').filter({ hasText: auditTitle }).first();
    await expect(auditRow).toBeVisible({ timeout: 10_000 });
    const completeAuditPromise = page.waitForResponse(response =>
      response.url().includes('/api/audit-tasks/') && response.url().includes('/complete') && response.request().method() === 'POST');
    await auditRow.getByRole('button', { name: 'Complete' }).click();
    await expectApiOk(completeAuditPromise, 'complete audit task');
    auditRow = page.locator('tbody tr').filter({ hasText: auditTitle }).first();
    const verifyAuditPromise = page.waitForResponse(response =>
      response.url().includes('/api/audit-tasks/') && response.url().includes('/verify') && response.request().method() === 'POST');
    await auditRow.getByRole('button', { name: 'QA Sign-off' }).click();
    await expectApiOk(verifyAuditPromise, 'verify audit task');
    await expect(page.locator('tbody tr').filter({ hasText: auditTitle }).first().getByText('Verified')).toBeVisible({ timeout: 10_000 });

    const metricNotes = unique('metric notes');
    await page.goto('/outcomes');
    await expect(page.getByRole('heading', { name: 'Outcome Metrics' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'New Metric' }).click();
    dialog = page.getByRole('dialog', { name: 'New Outcome Metric' });
    await dialog.getByLabel('Period start').fill('2026-05-01');
    await dialog.getByLabel('Period end').fill('2026-05-31');
    await dialog.getByLabel('Numerator').fill('2');
    await dialog.getByLabel('Denominator').fill('30');
    await dialog.getByLabel('Notes').fill(metricNotes);
    const metricPromise = page.waitForResponse(response =>
      response.url().includes(`/api/outcomes/metrics?${API_HOME}`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expectApiOk(metricPromise, 'create outcome metric');
    await expect(
      page.locator('tbody tr')
        .filter({ hasText: '2026-05-01 to 2026-05-31' })
        .filter({ hasText: '2 / 30' })
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    const topic = unique('reflection');
    await page.goto('/hr/reflective-practice');
    await expect(page.getByRole('heading', { name: 'Reflective Practice' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'New Reflection' }).click();
    dialog = page.getByRole('dialog', { name: 'New Reflection' });
    await dialog.getByLabel('Topic').fill(topic);
    await dialog.getByLabel('Staff ID').fill('S001');
    await dialog.getByLabel('Reflection').fill('Reviewed V1 operating rhythm.');
    const reflectionPromise = page.waitForResponse(response =>
      response.url().includes(`/api/reflective-practice?${API_HOME}`) && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expectApiOk(reflectionPromise, 'create reflection');
    await expect(page.getByText(topic)).toBeVisible({ timeout: 10_000 });
  });

  test('internal bank search and emergency agency override are wired', async ({ page }) => {
    await page.goto('/internal-bank');
    await expect(page.getByRole('heading', { name: 'Internal Bank' })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('Role').selectOption('Carer');
    const candidatesPromise = page.waitForResponse(response =>
      response.url().includes('/api/internal-bank/candidates') && response.request().method() === 'GET');
    await page.getByRole('button', { name: 'Search' }).click();
    const candidates = await expectApiOk(candidatesPromise, 'internal bank search');
    expect(candidates.total).toBeGreaterThan(0);
    await expect(page.getByText('Alice Smith')).toBeVisible({ timeout: 10_000 });

    await page.goto('/payroll/agency');
    await expect(page.getByRole('heading', { name: 'Agency Tracker' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '+ Log Shift' }).click();
    const dialog = page.getByRole('dialog', { name: 'Log Agency Shift' });
    await expect(dialog).toBeVisible();
    await dialog.locator('select').first().selectOption({ label: 'E2E V1 Primary Agency' });
    await dialog.locator('input[type="date"]').fill('2026-05-17');
    await dialog.locator('select').nth(1).selectOption('AG-E');
    await dialog.locator('input[type="number"]').nth(0).fill('8');
    await dialog.locator('input[type="number"]').nth(1).fill('25');
    await dialog.getByPlaceholder(/specialist cover unavailable internally/i).fill('E2E V1 short-notice sickness');
    await dialog.getByLabel('Emergency override').check();
    await dialog.locator('textarea').last().fill('Handover safety required immediate external cover.');

    const attemptPromise = page.waitForResponse(response =>
      response.url().includes('/api/agency-attempts') && response.request().method() === 'POST');
    const shiftPromise = page.waitForResponse(response =>
      response.url().includes('/api/payroll/agency/shifts') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Save Shift' }).click();
    await expectApiOk(attemptPromise, 'create agency attempt');
    await expectApiOk(shiftPromise, 'create agency shift');
    await expect(page.getByRole('dialog', { name: 'Log Agency Shift' })).not.toBeVisible({ timeout: 10_000 });
  });
});
