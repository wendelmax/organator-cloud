import { test, expect } from "@playwright/test";

// Criar tenants é exclusivo do admin da plataforma (POST /v1/tenants).
test.use({ storageState: "e2e/.auth/admin.json" });

test.describe("Criação de tenants", () => {
  test("admin da plataforma cria um novo tenant", async ({ page }) => {
    const suffix = Date.now();
    await page.goto("/tenants");
    await expect(page.getByRole("heading", { name: "Tenants", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "Novo Tenant" }).click();
    await page.locator('input[name="name"]').fill(`Acme Corporation ${suffix}`);
    await page.locator('input[name="slug"]').fill(`acme-${suffix}`);
    await page.getByRole("button", { name: "Criar Tenant" }).click();
    await expect(page.getByText(`Acme Corporation ${suffix}`)).toBeVisible();
  });
});
