import { test, expect } from "@playwright/test";

test.describe("Catálogo de serviços (deploys)", () => {
  test("owner acessa o catálogo e o formulário de registro de serviço", async ({ page }) => {
    await page.goto("/services");
    await expect(page.getByRole("heading", { name: "Catálogo de Serviços" })).toBeVisible();
    await page.getByRole("button", { name: "Registrar Serviço" }).click();
    await expect(page.locator('select[name="cloudProvider"]')).toBeVisible();
  });
});

test.describe("Registro de serviço em VPS", () => {
  // Antes: o painel enviava cloudProvider=VPS e vpsHost, que a API recusava (400).
  test("owner registra um serviço VPS com imagem e destino", async ({ page }) => {
    const name = `vps-api-${Date.now()}`;
    await page.goto("/services");
    await page.getByRole("button", { name: "Registrar Serviço" }).click();
    await page.locator('input[name="name"]').fill(name);
    await page.locator('input[name="repository"]').fill("github.com/acme/vps-api");
    await page.locator('select[name="cloudProvider"]').selectOption("VPS");
    await page.locator('input[name="image"]').fill("ghcr.io/acme/vps-api:1.0.0");
    await page.locator('input[name="vpsHost"]').fill("deploy@10.0.0.5");
    await page.getByRole("button", { name: "Salvar" }).click();

    // Cabeçalho do card: nome do serviço ao lado do provedor.
    const header = page.locator("div.justify-between.items-start", { has: page.getByText(name, { exact: true }) });
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(header.getByText("VPS", { exact: true })).toBeVisible();
  });
});
