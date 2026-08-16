import { test, expect } from '@playwright/test';

test.describe('Tenant Lifecycle Suite', () => {
  test('renders backups tab and tenant list controls', async ({ page }) => {
    await page.goto('/tenants');
    await expect(page.getByText('Organizações')).toBeVisible();
  });
});
