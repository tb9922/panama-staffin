import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

test.describe('Accessibility smoke', () => {
  test('dashboard has no serious or critical axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Today's Coverage/i)).toBeVisible({ timeout: 15_000 });

    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const blockingViolations = scan.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
    expect(blockingViolations, JSON.stringify(blockingViolations, null, 2)).toEqual([]);
  });
});
