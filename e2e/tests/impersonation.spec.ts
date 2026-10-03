import { test, expect } from "@playwright/test";

// Suporte (#103): o admin da plataforma acessa como o owner do tenant "acme".
test.use({ storageState: "e2e/.auth/admin.json" });

test.describe("Sessão de suporte (impersonação)", () => {
  test("admin acessa como o owner, vê o banner e encerra a sessão", async ({ page }) => {
    await page.goto("/tenants");
    const row = page.locator("tr", { has: page.getByText("acme.organator.io", { exact: true }) });
    await row.getByRole("button", { name: "Acessar como" }).click();

    await page.getByLabel("Usuário").selectOption({ label: "Acme Owner (OWNER)" });
    await page.getByLabel("Motivo").fill("E2E: validar a sessão de suporte");
    await page.getByRole("button", { name: "Iniciar sessão de suporte" }).click();

    await page.waitForURL("**/services", { timeout: 20_000 });
    const banner = page.getByRole("alert").filter({ hasText: "Sessão de suporte" });
    await expect(banner).toContainText("owner@organator.app");
    await expect(banner).toContainText("ops@organator.app");

    await banner.getByRole("button", { name: "Encerrar sessão de suporte" }).click();
    await page.waitForURL("**/login", { timeout: 20_000 });
  });
});
