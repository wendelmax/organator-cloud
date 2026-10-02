import { test, expect } from "@playwright/test";

// Sessão do owner vem do projeto "setup" (playwright.config.ts).

test.describe("Dashboard", () => {
  test("página inicial mostra cards de visão geral", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    // Números reais do tenant (antes: valores fixos e uma receita inventada).
    for (const label of ["Microsserviços", "Deploys", "Membros"]) {
      const card = page.locator("div.rounded-xl", { has: page.getByRole("heading", { name: label, exact: true }) });
      await expect(card.locator("p")).toHaveText(/^\d+$/);
    }
    await expect(page.getByText("Receita (Stripe)")).toHaveCount(0);
    // Total de tenants é só para o admin da plataforma.
    await expect(page.getByText("Total de Tenants")).toHaveCount(0);
  });

  test("sidebar de navegação lista todas as seções", async ({ page }) => {
    await page.goto("/");
    for (const link of ["Tenants", "Services Catalog", "Developer Portal", "Billing (Stripe)"]) {
      await expect(page.getByRole("link", { name: link })).toBeVisible();
    }
  });
});

test.describe("Services Catalog", () => {
  test("renderiza a lista de serviços", async ({ page }) => {
    await page.goto("/services");
    await expect(page.getByRole("heading", { name: "Catálogo de Serviços" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Registrar Serviço" })).toBeVisible();
  });

  test("registra um novo microsserviço (Vercel)", async ({ page }) => {
    const suffix = Date.now();
    await page.goto("/services");
    await page.getByRole("button", { name: "Registrar Serviço" }).click();
    await page.locator('input[name="name"]').fill(`Auth API ${suffix}`);
    await page.locator('input[name="repository"]').fill(`github.com/org/auth-api-${suffix}`);
    await page.locator('select[name="cloudProvider"]').selectOption("VERCEL");
    await page.getByRole("button", { name: "Salvar" }).click();
    await expect(page.getByText(`Auth API ${suffix}`)).toBeVisible();
  });
});

test.describe("Tenants", () => {
  // Criação de tenant (admin da plataforma) fica em tenant-infra.spec.ts.
  test("convidar membro na aba Membros", async ({ page }) => {
    const suffix = Date.now();
    await page.goto("/tenants");
    await page.getByRole("button", { name: "Membros da Organização" }).click();
    await page.getByRole("button", { name: "Convidar Membro" }).first().click();
    await page.locator('input[name="name"]').fill("João Silva");
    await page.locator('input[name="email"]').fill(`joao${suffix}@empresa.com`);
    await page.locator('select[name="role"]').selectOption("DEVELOPER");
    await page
      .locator("form")
      .getByRole("button", { name: "Convidar Membro" })
      .click();
    await expect(page.getByText(`joao${suffix}@empresa.com`)).toBeVisible();
    await expect(
      page.getByRole("row", { name: new RegExp(`joao${suffix}@empresa.com`) })
    ).toContainText("DEVELOPER");
  });
});

test.describe("Billing", () => {
  test("renderiza gestão financeira com assinatura", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "Gestão Financeira & Faturamento" })).toBeVisible();
    await expect(page.getByText("Assinatura Atual")).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir Stripe Customer Portal" })).toBeVisible();
  });

  test("explica quando a organização ainda não tem conta de cobrança", async ({ page }) => {
    // O tenant do seed nunca passou por checkout: não há customer no Stripe.
    await page.goto("/billing");
    await page.getByRole("button", { name: "Abrir Stripe Customer Portal" }).click();
    await expect(page.getByText(/no billing account yet/)).toBeVisible();
    await expect(page).toHaveURL(/\/billing$/);
  });
});

test.describe("Developer Portal", () => {
  test("publica uma especificação OpenAPI", async ({ page }) => {
    const suffix = Date.now();
    await page.goto("/portal");
    await expect(page.getByRole("heading", { name: "Developer Portal" })).toBeVisible();
    await page.getByRole("button", { name: "Publicar OpenAPI Spec" }).click();
    await page.getByPlaceholder("ex: Payment Service API").fill(`Payment Service API ${suffix}`);
    await page.getByPlaceholder("ex: 1.0.0").fill("1.0.0");
    await page.getByPlaceholder("ex: service-payment-api").fill(`svc-payment-${suffix}`);
    await page
      .getByPlaceholder("Cole aqui o conteúdo da spec...")
      .fill('{"openapi":"3.0.0","info":{"title":"Payment API"}}');
    await page.getByRole("button", { name: "Salvar e Publicar" }).click();
    await expect(page.getByText(`Payment Service API ${suffix}`)).toBeVisible();
  });
});
