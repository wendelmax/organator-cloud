import { test, expect } from "@playwright/test";
import { loginAs } from "../helpers";

test.beforeEach(async ({ page }) => {
  await loginAs(page, "owner@organator.app");
});

test.describe("Dashboard", () => {
  test("página inicial mostra cards de visão geral", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Total Tenants")).toBeVisible();
    await expect(page.getByText("Microserviços")).toBeVisible();
    await expect(page.getByText("Receita (Stripe)")).toBeVisible();
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
  test("cria um novo tenant", async ({ page }) => {
    const suffix = Date.now();
    await page.goto("/tenants");
    await expect(page.getByRole("heading", { name: "Tenants" })).toBeVisible();
    await page.getByRole("button", { name: "Novo Tenant" }).click();
    await page.locator('input[name="name"]').fill(`Acme Corporation ${suffix}`);
    await page.locator('input[name="slug"]').fill(`acme-${suffix}`);
    await page.getByRole("button", { name: "Criar Tenant" }).click();
    await expect(page.getByText(`Acme Corporation ${suffix}`)).toBeVisible();
  });

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
