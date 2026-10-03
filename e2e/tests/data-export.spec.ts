import { test, expect } from "@playwright/test";

// No CI o worker não roda: o pedido fica "Gerando" (a geração é coberta nos
// testes do worker). Aqui valida o pedido pelo painel e a janela de 24h.
test.describe("Exportação de dados (LGPD)", () => {
  test("owner pede a exportação e um segundo pedido não duplica", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Meus dados (LGPD)")).toBeVisible();

    await page.getByRole("button", { name: "Exportar meus dados" }).click();
    await expect(page.getByRole("status")).toContainText("Pedido registrado");
    const items = page.locator("li", { hasText: /Gerando|Pronto/ });
    await expect(items).toHaveCount(1);

    await page.getByRole("button", { name: "Exportar meus dados" }).click();
    await expect(page.getByRole("status")).toContainText("Pedido registrado");
    await expect(items).toHaveCount(1);
  });
});
