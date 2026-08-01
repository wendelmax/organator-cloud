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
    await expect(page.getByRole("button", { name: "Pagar via Stripe" })).toBeVisible();
  });

  test("viewer de documentação (Redoc) renderiza", async ({ page }) => {
    await page.goto("/docs/svc-payment");
    await expect(page.getByText("Organator - API Reference")).toBeVisible();
    await expect(page.getByRole("link", { name: "Área do Desenvolvedor" })).toBeVisible();
  });
});
