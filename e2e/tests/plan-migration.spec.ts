import { test, expect } from '@playwright/test';

test.describe('Plan Migration & Grace Period', () => {
  test('renders settings page without errors', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Configurações')).toBeVisible();
  });
});
