import { test, expect } from "@playwright/test";

test.describe("Privacidade (LGPD)", () => {
  test("owner liga e desliga marketing e a preferência persiste", async ({ page }) => {
    await page.goto("/settings");
    const marketing = page.getByRole("checkbox", { name: "Novidades e comunicações de marketing por e-mail" });
    await expect(marketing).not.toBeChecked();

    await marketing.check();
    await expect(page.getByRole("status")).toHaveText("Preferência ativada.");
    await page.reload();
    await expect(marketing).toBeChecked();

    await marketing.uncheck();
    await expect(page.getByRole("status")).toContainText("Preferência desativada");
    await page.reload();
    await expect(marketing).not.toBeChecked();
    await expect(page.getByText(/Termos de uso: versão 2026-10/)).toBeVisible();
  });
});
