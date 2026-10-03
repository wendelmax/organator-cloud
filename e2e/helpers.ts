import { Page } from "@playwright/test";

const DEFAULT_PASSWORD = "Owner1234!";

export async function loginAs(page: Page, email: string, password: string = DEFAULT_PASSWORD) {
  await page.goto("/login");
  await page.getByPlaceholder("admin@organator.app").fill(email);
  await page.getByPlaceholder("••••••••").first().fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/services", { timeout: 20_000 });
}

/**
 * Conta nova (convite, cadastro grátis): o primeiro acesso passa pela tela de
 * termos/privacidade antes do painel.
 */
export async function acceptConsentAndEnter(page: Page) {
  await page.waitForURL(/\/consent/, { timeout: 20_000 });
  await page.getByRole("checkbox", { name: /Termos de uso/ }).check();
  await page.getByRole("checkbox", { name: /Política de privacidade/ }).check();
  await page.getByRole("button", { name: "Aceitar e continuar" }).click();
  await page.waitForURL("**/services", { timeout: 20_000 });
}
