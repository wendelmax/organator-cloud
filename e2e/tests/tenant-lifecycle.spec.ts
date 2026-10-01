import { test, expect } from "@playwright/test";

test.describe("Tenants (owner)", () => {
  test("owner vê a lista de tenants sem a ação de criar tenant", async ({ page }) => {
    await page.goto("/tenants");
    await expect(page.getByRole("heading", { name: "Tenants", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Organizações" })).toBeVisible();
    // POST /v1/tenants é exclusivo do admin da plataforma.
    await expect(page.getByRole("button", { name: "Novo Tenant" })).toHaveCount(0);
  });
});
