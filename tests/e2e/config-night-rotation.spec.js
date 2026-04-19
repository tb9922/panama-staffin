import { expect, test } from '@playwright/test';

test.describe('Night rotation settings', () => {
  test('night rotation controls persist a separate night cycle start date', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });

    const nightPatternHeading = page.getByRole('heading', { name: 'Night Rotation Pattern' });
    const nightTuningHeading = page.getByRole('heading', { name: 'Night Cycle Start Tuning' });
    const nightCycleInput = page.locator('#config-night-cycle-start-date');

    await expect(nightPatternHeading).toBeVisible({ timeout: 10_000 });
    await expect(nightTuningHeading).toBeVisible({ timeout: 10_000 });
    await expect(nightCycleInput).toBeVisible({ timeout: 10_000 });

    const originalValue = await nightCycleInput.inputValue();
    const nextValue = originalValue === '2025-01-13' ? '2025-01-20' : '2025-01-13';

    const tuningSection = nightTuningHeading.locator('xpath=..');
    await expect(tuningSection.getByRole('button', { name: 'Analyse all 14 offsets' })).toBeVisible({ timeout: 10_000 });

    const saveResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/homes/config?home=e2e-test-home') && response.request().method() === 'PUT');
    await nightCycleInput.fill(nextValue);
    await page.getByRole('button', { name: /Save Changes/ }).click();
    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok(), await saveResponse.text()).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Saved!' })).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#config-night-cycle-start-date')).toHaveValue(nextValue);

    const restoreResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/homes/config?home=e2e-test-home') && response.request().method() === 'PUT');
    await page.locator('#config-night-cycle-start-date').fill(originalValue);
    await page.getByRole('button', { name: /Save Changes/ }).click();
    const restoreResponse = await restoreResponsePromise;
    expect(restoreResponse.ok(), await restoreResponse.text()).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Saved!' })).toBeVisible({ timeout: 10_000 });
  });
});
