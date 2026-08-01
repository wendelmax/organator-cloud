import { test, expect } from "@playwright/test";

test.describe("Autenticação", () => {
  test("login page renderiza com SSO VoidAuth", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Organator" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar com VoidAuth (SSO)" })).toBeVisible();
  });

  test("credenciais inválidas exibem erro", async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder("admin@organator.app").fill("admin@organator.app");
    await page.getByPlaceholder("••••••••").first().fill("senha-errada");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByText("Credenciais inválidas")).toBeVisible();
  });

  test("fluxo de troca obrigatória de senha (mustChangePassword)", async ({ page }) => {
    const OLD = "Temp1234!";
    const NEW = "NovaSenha456!";

    await page.goto("/login");
    await page.getByPlaceholder("admin@organator.app").fill("admin@organator.app");
    await page.getByPlaceholder("••••••••").first().fill(OLD);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    // 1) Deve ser redirecionado para /set-password (guard do dashboard)
    await page.waitForURL("**/set-password", { timeout: 20_000 });
    await expect(page.getByText(/defina uma nova senha/i)).toBeVisible();

    // 2) Trocar senha
    const pwFields = page.locator('input[type="password"]');
    await pwFields.nth(0).fill(OLD); // senha atual
    await pwFields.nth(1).fill(NEW); // nova
    await pwFields.nth(2).fill(NEW); // confirmar
    await page.getByRole("button", { name: "Definir nova senha" }).click();

    // 3) Deve re-autenticar e ir para o dashboard
    await page.waitForURL("**/services", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Catálogo de Serviços" })).toBeVisible();

    // 4) Novo login com a nova senha funciona e vai direto ao dashboard
    await page.goto("/login");
    await page.getByPlaceholder("admin@organator.app").fill("admin@organator.app");
    await page.getByPlaceholder("••••••••").first().fill(NEW);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.waitForURL("**/services", { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Catálogo de Serviços" })).toBeVisible();
  });
});
