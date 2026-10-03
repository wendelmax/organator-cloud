import { test, expect } from "@playwright/test";

// Direito ao esquecimento ponta a ponta (API + Postgres reais): convidado cria
// a conta, apaga a si mesmo e não consegue mais entrar.
test.describe("Excluir minha conta (LGPD)", () => {
  test("o titular apaga a própria conta e não consegue mais entrar", async ({ page, browser }) => {
    const email = `apagar${Date.now()}@acme.com`;
    const password = "Apagar1234!";

    await page.goto("/invitations");
    await page.getByPlaceholder("email@empresa.com").fill(email);
    await page.getByRole("button", { name: "Convidar" }).click();
    const link = page.locator("code").filter({ hasText: "/accept-invite?token=" });
    await expect(link).toBeVisible();
    const url = (await link.textContent())!.trim();

    const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guestPage = await guest.newPage();
    await guestPage.goto(url);
    await guestPage.getByLabel("Crie uma senha").fill(password);
    await guestPage.getByLabel("Confirme a senha").fill(password);
    await guestPage.getByRole("button", { name: "Aceitar convite" }).click();
    await expect(guestPage.getByText(/Você agora faz parte de/)).toBeVisible();

    await guestPage.goto("/login");
    await guestPage.getByPlaceholder("admin@organator.app").fill(email);
    await guestPage.getByPlaceholder("••••••••").fill(password);
    await guestPage.getByRole("button", { name: "Entrar", exact: true }).click();
    await guestPage.waitForURL("**/services", { timeout: 20_000 });

    await guestPage.goto("/settings");
    await guestPage.getByRole("button", { name: "Excluir minha conta" }).click();
    await guestPage.getByLabel("Confirmação para excluir a conta").fill("senha-errada");
    await guestPage.getByRole("button", { name: "Excluir definitivamente" }).click();
    await expect(guestPage.getByRole("status")).toHaveText("Senha incorreta");

    await guestPage.getByLabel("Confirmação para excluir a conta").fill(password);
    await guestPage.getByRole("button", { name: "Excluir definitivamente" }).click();
    await guestPage.waitForURL(/\/login\?erased=true$/, { timeout: 20_000 });
    await expect(guestPage.getByText(/Sua conta foi excluída/)).toBeVisible();

    await guestPage.getByPlaceholder("admin@organator.app").fill(email);
    await guestPage.getByPlaceholder("••••••••").fill(password);
    await guestPage.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(guestPage.getByText(/Credenciais inválidas/)).toBeVisible();
    await guest.close();
  });
});
