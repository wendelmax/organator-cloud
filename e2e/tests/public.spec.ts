import { test, expect } from "@playwright/test";

test.describe("Páginas públicas", () => {
  test("página de cadastro renderiza wizard de 2 passos", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByText("Comece a usar o Organator hoje.")).toBeVisible();
    await expect(page.getByText("Crie sua Conta")).toBeVisible();

    await page.getByPlaceholder("Ex: John").fill("John");
    await page.getByPlaceholder("Ex: Doe").fill("Doe");
    await page.getByPlaceholder("john@empresa.com").fill("john@empresa.com");
    await page.getByPlaceholder("Ex: Acme Corp").fill("Acme Corp");
    await page.getByRole("button", { name: "Continuar para Planos" }).click();

    await expect(page.getByText("Escolha um Plano")).toBeVisible();
    await expect(page.getByText("Pro", { exact: true })).toBeVisible();
    await expect(page.getByText("Enterprise", { exact: true })).toBeVisible();
    // Preços vêm dos planos cadastrados (e2e/seed.mjs), os mesmos cobrados no checkout.
    await expect(page.getByText(/US\$\s49,00\/mês/)).toBeVisible();
    await expect(page.getByText(/US\$\s199,00\/mês/)).toBeVisible();
    // O plano gratuito não passa pelo checkout pago.
    await expect(page.getByText("Free", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pagar via Stripe" })).toBeEnabled();
  });

  test("viewer de documentação (Redoc) renderiza", async ({ page }) => {
    await page.goto("/docs/svc-payment");
    await expect(page.getByText("Organator - API Reference")).toBeVisible();
    await expect(page.getByRole("link", { name: "Área do Desenvolvedor" })).toBeVisible();
  });
});
