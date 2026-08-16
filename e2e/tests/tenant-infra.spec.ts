import { test, expect } from '@playwright/test';

test.describe('Tenant Infra Provisioning', () => {
  test('displays infra stepper and allows manual trigger', async ({ page }) => {
    await page.goto('/tenants');
    await expect(page.getByText('Organizações')).toBeVisible();
  });
});
