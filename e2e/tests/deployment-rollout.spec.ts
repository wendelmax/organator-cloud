import { test, expect } from "@playwright/test";

test.describe("Catálogo de serviços (deploys)", () => {
  test("owner acessa o catálogo e o formulário de registro de serviço", async ({ page }) => {
    await page.goto("/services");
    await expect(page.getByRole("heading", { name: "Catálogo de Serviços" })).toBeVisible();
    await page.getByRole("button", { name: "Registrar Serviço" }).click();
    await expect(page.locator('select[name="cloudProvider"]')).toBeVisible();
  });
});
