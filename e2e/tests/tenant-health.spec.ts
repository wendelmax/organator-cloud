import { test, expect } from '@playwright/test';

test.describe('Tenant Environments & Health Suite', () => {
  test('renders health dashboard controls', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByText('Configurações')).toBeVisible();
  });
});
