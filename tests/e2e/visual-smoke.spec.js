import { expect, test } from '@playwright/test';

async function expectNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => {
    const doc = globalThis.document.documentElement;
    const body = globalThis.document.body;
    return Math.max(doc.scrollWidth, body.scrollWidth) - Math.max(doc.clientWidth, body.clientWidth);
  });
  expect(overflow).toBeLessThanOrEqual(2);
}

test.describe('Visual smoke', () => {
  test('staff add modal stays visually stable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.goto('/staff');
    await expect(page.getByRole('heading', { name: 'Staff Database' })).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /\+ Add Staff/i }).click({ force: true, timeout: 10_000 });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toHaveScreenshot('staff-add-modal.png', {
      animations: 'disabled',
      maxDiffPixels: 250,
    });
  });

  test('daily status fixed-date layout stays visually stable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1400 });
    await page.goto('/day/2026-04-20');
    await expect(page.getByRole('heading', { name: /Monday,?\s+20 April 2026/i })).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('main')).toHaveScreenshot('daily-status-2026-04-20.png', {
      animations: 'disabled',
      maxDiffPixels: 250,
    });
  });

  const mobileRoutes = [
    { route: '/portfolio', ready: /Portfolio Dashboard/i },
    { route: '/actions', ready: /Manager Actions/i },
    { route: '/internal-bank', ready: /Internal Bank/i },
    { route: '/audit-calendar', ready: /Audit Calendar/i },
    { route: '/staff', ready: /Staff Database/i },
    { route: '/rotation', ready: /Roster/i },
  ];

  for (const viewport of [
    { name: 'phone', width: 390, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
  ]) {
    test(`key pages fit the ${viewport.name} viewport`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const item of mobileRoutes) {
        await test.step(`${viewport.name} ${item.route}`, async () => {
          await page.goto(item.route);
          await expect(page.locator('main#main-content')).toBeVisible({ timeout: 15_000 });
          await expect(page.getByRole('heading', { name: item.ready })).toBeVisible({ timeout: 15_000 });
          await expectNoHorizontalOverflow(page);
          await page.screenshot({
            path: testInfo.outputPath(`${viewport.name}-${item.route.replaceAll('/', '_').replace(/^_/, '') || 'home'}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        });
      }
    });
  }
});
