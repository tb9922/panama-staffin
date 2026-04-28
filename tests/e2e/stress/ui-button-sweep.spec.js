import { expect, test } from '@playwright/test';

const ALL_ROUTES = [
  '/',
  '/day',
  '/day/2026-03-02',
  '/handover',
  '/rotation',
  '/scenarios',
  '/leave',
  '/staff',
  '/internal-bank',
  '/onboarding',
  '/onboarding/docs',
  '/training',
  '/sick-trends',
  '/fatigue',
  '/care-cert',
  '/cqc',
  '/cqc/docs',
  '/incidents',
  '/complaints',
  '/dols',
  '/ipc',
  '/maintenance',
  '/maintenance/docs',
  '/actions',
  '/audit-calendar',
  '/risks',
  '/policies',
  '/speak-up',
  '/hr',
  '/hr/disciplinary',
  '/hr/grievance',
  '/hr/performance',
  '/hr/absence',
  '/hr/reflective-practice',
  '/hr/contracts',
  '/hr/family-leave',
  '/hr/flex-working',
  '/hr/edi',
  '/hr/tupe',
  '/hr/renewals',
  '/residents',
  '/beds',
  '/finance',
  '/finance/income',
  '/finance/expenses',
  '/finance/docs',
  '/finance/receivables',
  '/finance/payables',
  '/suppliers',
  '/costs',
  '/budget',
  '/payroll/rates',
  '/payroll/clock-ins',
  '/payroll/timesheets',
  '/payroll/monthly-timesheet',
  '/payroll/monthly-timesheet/S001',
  '/payroll/agency',
  '/payroll/tax-codes',
  '/payroll/pensions',
  '/payroll/sick-pay',
  '/payroll/hmrc',
  '/payroll',
  '/gdpr',
  '/ropa',
  '/dpia',
  '/portfolio',
  '/outcomes',
  '/reports',
  '/evidence',
  '/audit',
  '/users',
  '/settings',
  '/scan-inbox',
  '/platform/homes',
];

const ROUTE_FILTER = String(process.env.UI_STRESS_ROUTES || '')
  .split(',')
  .map(route => route.trim().replace(/\\/g, '/'))
  .filter(Boolean);
const ROUTES = ROUTE_FILTER.length > 0
  ? ALL_ROUTES.filter(route => ROUTE_FILTER.includes(route) || ROUTE_FILTER.includes(route.replace(/^\//, '')))
  : ALL_ROUTES;

const MAX_BUTTONS_PER_ROUTE = Number(process.env.UI_STRESS_MAX_BUTTONS || 24);
const STRESS_SEARCH = `stress "quote" <script>alert(1)</script> ${'x'.repeat(48)}`;

const CONSOLE_IGNORE = [
  /Download the React DevTools/i,
  /ResizeObserver loop/i,
  /Blocked aria-hidden/i,
];

const DANGEROUS_BUTTON = /\b(delete|remove|void|deactivate|revoke|reset password|approve|reject|mark paid|purge|merge|confirm delete|permanently)\b/i;

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function watchProblems(page) {
  const problems = [];
  page.on('dialog', dialog => {
    const action = dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss();
    action.catch(() => {});
  });
  page.on('download', download => download.delete().catch(() => {}));
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_IGNORE.some(pattern => pattern.test(text))) return;
    problems.push(`console: ${text}`);
  });
  page.on('response', response => {
    if (!response.url().includes('/api/')) return;
    if (response.status() >= 500) {
      problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText || '';
    if (!request.url().includes('/api/')) return;
    if (/ERR_ABORTED|cancelled|NS_BINDING_ABORTED/i.test(failure)) return;
    problems.push(`requestfailed: ${request.method()} ${request.url()} ${failure}`);
  });
  return problems;
}

async function waitQuiet(page) {
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(150);
}

async function expectHealthy(page, route, problems, startIndex) {
  await waitQuiet(page);
  await expect(page.locator('main#main-content')).toBeVisible({ timeout: 10_000 });
  expect(problems.slice(startIndex), `Browser/API problems on ${route}`).toEqual([]);
  await expect(page.locator('body')).not.toContainText(
    /Something went wrong|Page not found|You don't have access|Cannot read properties|Minified React error/i,
  );
}

async function buttonSnapshot(page) {
  const locator = await buttonLocator(page);
  return locator.evaluateAll(nodes => nodes.map((node, rawIndex) => {
    const element = /** @type {HTMLElement} */ (node);
    const style = globalThis.getComputedStyle(element);
    const visible = style.visibility !== 'hidden'
      && style.display !== 'none'
      && element.getClientRects().length > 0;
    const disabled = element.matches('button:disabled') || element.getAttribute('aria-disabled') === 'true';
    const text = element.innerText || element.textContent || '';
    const label = [
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      text,
      element.getAttribute('name'),
      element.id,
    ].filter(Boolean).join(' | ').replace(/\s+/g, ' ').trim();
    const dialog = element.closest('[role="dialog"]');
    const dialogLabel = dialog?.getAttribute('aria-label') || dialog?.querySelector('h1,h2,h3')?.textContent || '';
    return {
      rawIndex,
      label,
      text: text.replace(/\s+/g, ' ').trim(),
      visible,
      disabled,
      inDialog: Boolean(dialog),
      dialogLabel: dialogLabel.replace(/\s+/g, ' ').trim(),
    };
  }).filter(item => item.visible && !item.disabled));
}

async function buttonLocator(page) {
  const dialogButtons = page.locator('[role="dialog"]:visible button');
  if (await dialogButtons.count() > 0) return dialogButtons;
  return page.locator('main#main-content button');
}

async function closeOverlays(page) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const dialog = page.locator('[role="dialog"]').first();
    if (!await dialog.isVisible().catch(() => false)) return;
    const closeButton = dialog.getByRole('button', { name: /cancel|close|dismiss|done|back/i }).first();
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click({ timeout: 3_000 }).catch(() => page.keyboard.press('Escape'));
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(150);
  }
}

async function exerciseSearchFields(page) {
  const searchInputs = page.locator(
    [
      'main#main-content input[type="search"]',
      'main#main-content input[placeholder*="Search" i]',
      'main#main-content input[aria-label*="Search" i]',
      'main#main-content input[name*="search" i]',
      'main#main-content input[placeholder*="Filter" i]',
      'main#main-content input[aria-label*="Filter" i]',
    ].join(', '),
  );
  const count = Math.min(await searchInputs.count(), 4);
  for (let index = 0; index < count; index += 1) {
    const input = searchInputs.nth(index);
    if (!await input.isVisible().catch(() => false)) continue;
    if (!await input.isEnabled().catch(() => false)) continue;
    await input.fill(STRESS_SEARCH, { timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(80);
    await input.fill('', { timeout: 3_000 }).catch(() => {});
  }
}

async function clickCandidate(page, candidate) {
  const locator = await buttonLocator(page);
  if (candidate.rawIndex >= await locator.count()) return false;
  const button = locator.nth(candidate.rawIndex);
  if (!await button.isVisible().catch(() => false)) return false;
  if (!await button.isEnabled().catch(() => false)) return false;
  await button.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
  try {
    await button.click({ timeout: 5_000 });
    return true;
  } catch (error) {
    if (/waiting for locator/i.test(error.message || '')) return false;
    throw error;
  }
}

test.describe('UI stress sweep', () => {
  test('admin can exercise visible route buttons without client crashes or 5xx APIs', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const problems = watchProblems(page);
    const summary = [];

    for (const route of ROUTES) {
      await test.step(`stress ${route}`, async () => {
        const problemStart = problems.length;
        const clicked = [];
        const skippedDangerous = [];
        const seen = new Set();

        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await expectHealthy(page, route, problems, problemStart);
        await exerciseSearchFields(page);
        await expectHealthy(page, route, problems, problemStart);

        for (let pass = 0; pass < MAX_BUTTONS_PER_ROUTE; pass += 1) {
          const buttons = await buttonSnapshot(page);
          const candidate = buttons.find(button => {
            const label = normalize(button.label || button.text || `button-${button.rawIndex}`);
            const fingerprint = `${button.inDialog ? 'dialog' : 'main'}:${button.dialogLabel}:${label}`;
            if (seen.has(fingerprint)) return false;
            seen.add(fingerprint);
            if (DANGEROUS_BUTTON.test(label)) {
              skippedDangerous.push(label);
              return false;
            }
            return true;
          });

          if (!candidate) break;
          const label = normalize(candidate.label || candidate.text || `button-${candidate.rawIndex}`);
          clicked.push(label);
          console.log(`[ui-stress] ${route} -> ${label}`);

          const didClick = await clickCandidate(page, candidate);
          if (!didClick) {
            console.log(`[ui-stress] ${route} -> stale before click: ${label}`);
            continue;
          }
          await waitQuiet(page);
          await expectHealthy(page, route, problems, problemStart);

          const currentPath = new URL(page.url()).pathname;
          if (currentPath !== route.split('?')[0]) {
            await page.goto(route, { waitUntil: 'domcontentloaded' });
            await expectHealthy(page, route, problems, problemStart);
          }
        }

        await closeOverlays(page);
        await expectHealthy(page, route, problems, problemStart);
        summary.push({
          route,
          clicked: clicked.length,
          skippedDangerous: [...new Set(skippedDangerous)].length,
          examples: clicked.slice(0, 6),
        });
      });
    }

    console.table(summary);
  });
});
