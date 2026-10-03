import { test, expect } from "@playwright/test";

// Só mexe em expiração/bloqueio: os outros testes do tenant "acme" (em paralelo)
// criam senhas e não podem ser afetados por exigências de complexidade.
test.describe("Política de senha do tenant", () => {
  test("owner salva a política e a API recusa valores fora da faixa", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Política de senha")).toBeVisible();

    await page.getByLabel("Expiração (dias)").fill("90");
    await page.getByLabel("Bloqueio (minutos)").fill("30");
    await page.getByRole("button", { name: "Salvar política" }).click();
    await expect(page.getByRole("status")).toHaveText("Política de senha atualizada.");

    await page.reload();
    await expect(page.getByLabel("Expiração (dias)")).toHaveValue("90");
    await expect(page.getByLabel("Bloqueio (minutos)")).toHaveValue("30");

    // Valor inválido: a mensagem da API aparece no card.
    await page.getByLabel("Tamanho mínimo").fill("4");
    await page.getByRole("button", { name: "Salvar política" }).click();
    await expect(page.getByRole("status")).toContainText("minLength must be an integer between 8 and 128");

    // Volta ao estado original.
    await page.reload();
    await page.getByLabel("Expiração (dias)").fill("");
    await page.getByLabel("Bloqueio (minutos)").fill("");
    await page.getByRole("button", { name: "Salvar política" }).click();
    await expect(page.getByRole("status")).toHaveText("Política de senha atualizada.");
  });
});
