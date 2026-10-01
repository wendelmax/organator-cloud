import { test, expect } from "@playwright/test";

test.describe("Configurações do tenant", () => {
  test("owner vê e pode salvar os dados da organização", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Configurações", level: 1 })).toBeVisible();
    await expect(page.getByText("Organização", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Salvar alterações" })).toBeVisible();
  });
});
