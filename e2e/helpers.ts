import { Page } from "@playwright/test";

const DEFAULT_PASSWORD = "Owner1234!";

export async function loginAs(page: Page, email: string, password: string = DEFAULT_PASSWORD) {
  await page.goto("/login");
  await page.getByPlaceholder("admin@organator.app").fill(email);
  await page.getByPlaceholder("••••••••").first().fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/services", { timeout: 20_000 });
}
