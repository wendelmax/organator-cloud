import { test, expect } from "@playwright/test";

// Cupons (#95): sem Stripe real no CI o checkout não é testado aqui; o resto do
// ciclo (criar, validar no cadastro, desativar) roda contra a API e o Postgres.
test.use({ storageState: "e2e/.auth/admin.json" });

test.describe("Cupons", () => {
  test("admin cria, o cadastro valida o desconto e a desativação vale na hora", async ({ page, browser }) => {
    const code = `E2E${Date.now()}`;

    await page.goto("/billing/plans");
    await page.getByLabel("Código do cupom").fill(code);
    await page.getByLabel("Desconto (%)").fill("20");
    await page.getByRole("button", { name: "Criar cupom" }).click();
    await expect(page.getByRole("status")).toHaveText("Cupom criado.");
    const row = page.locator("li", { hasText: code });
    await expect(row).toContainText("20%");

    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const signup = await visitor.newPage();
    await signup.goto("/register");
    await signup.getByPlaceholder("Ex: John").fill("Cupom");
    await signup.getByPlaceholder("Ex: Doe").fill("Teste");
    await signup.getByPlaceholder("john@empresa.com").fill(`cupom${Date.now()}@empresa.com`);
    await signup.getByPlaceholder("Ex: Acme Corp").fill(`Cupom Org ${Date.now()}`);
    await signup.getByRole("button", { name: "Continuar para Planos" }).click();
    await signup.getByText("Pro", { exact: true }).click();

    const couponField = signup.getByLabel("Cupom de desconto");
    await couponField.fill(code.toLowerCase());
    await couponField.blur();
    await expect(signup.getByText(`Cupom ${code}: 20% de desconto na primeira cobrança.`)).toBeVisible();

    await row.getByRole("button", { name: "Desativar" }).click();
    await expect(row.getByRole("button", { name: "Desativar" })).toHaveCount(0);

    await couponField.fill(code);
    await couponField.blur();
    await expect(signup.getByText(/Cupom inválido: não encontrado ou desativado/)).toBeVisible();
    await visitor.close();
  });
});
