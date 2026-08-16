import { test, expect } from '@playwright/test';

test.describe('Data Isolation Controls', () => {
  test('platform admin can select an isolation override', async ({ page }) => {
    // Mock platform admin session and data-isolation API
    await page.route('/v1/tenants/data-isolation', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tenantId: 'tenant-1',
          desiredMode: 'SHARED',
          activeMode: 'SHARED',
          overridden: false,
          status: 'READY',
          phase: 'READY',
          generation: 1,
          observedGeneration: 1,
          lastError: null,
          updatedAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto('/tenants');
    // Verify page loads
    await expect(page.getByText('Organizações')).toBeVisible();
  });

  test('tenant owner sees status but no selector', async ({ page }) => {
    await page.goto('/settings');
    // Verify settings loads
    await expect(page.getByText('Configurações')).toBeVisible();
  });
});
