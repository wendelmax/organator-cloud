import { test, expect } from "@playwright/test";

test.describe("Convites", () => {
  test("convidado aceita pelo link, cria a senha e entra", async ({ page, browser }) => {
    const email = `convidado${Date.now()}@acme.com`;
    const password = "Convidado123";

    // 1) Owner convida pelo painel. Sem SMTP no CI, o link é exibido.
    await page.goto("/invitations");
    await page.getByPlaceholder("email@empresa.com").fill(email);
    await page.getByRole("button", { name: "Convidar" }).click();
    const link = page.locator("code").filter({ hasText: "/accept-invite?token=" });
    await expect(link).toBeVisible();
    const url = (await link.textContent())!.trim();

    // 2) Convidado, sem sessão, abre o link e cria a senha.
    const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const guestPage = await guest.newPage();
    await guestPage.goto(url);
    await expect(guestPage.getByText(email)).toBeVisible();
    await guestPage.getByLabel("Seu nome").fill("Convidado E2E");
    await guestPage.getByLabel("Crie uma senha").fill(password);
    await guestPage.getByLabel("Confirme a senha").fill(password);
    await guestPage.getByRole("button", { name: "Aceitar convite" }).click();
    await expect(guestPage.getByText(/Você agora faz parte de/)).toBeVisible();

    // 3) O link não vale uma segunda vez.
    await guestPage.goto(url);
    await expect(guestPage.getByText(/inválido, expirou ou já foi usado/)).toBeVisible();

    // 4) Login com a senha escolhida.
    await guestPage.goto("/login");
    await guestPage.getByPlaceholder("admin@organator.app").fill(email);
    await guestPage.getByPlaceholder("••••••••").fill(password);
    await guestPage.getByRole("button", { name: "Entrar", exact: true }).click();
    await guestPage.waitForURL("**/services", { timeout: 20_000 });
    await guest.close();

    // 5) No painel do owner o convite aparece como aceito.
    await page.reload();
    await expect(page.getByText(new RegExp(`Aceito`)).first()).toBeVisible();
  });
});
