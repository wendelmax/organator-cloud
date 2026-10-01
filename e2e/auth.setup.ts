import { test as setup } from "@playwright/test";
import { loginAs } from "./helpers";

// Sessão do owner do tenant "acme" (criado por e2e/seed.mjs), reaproveitada
// pelo projeto "authenticated" do playwright.config.ts.
setup("authenticate as tenant owner", async ({ page }) => {
  await loginAs(page, "owner@organator.app", "Owner1234!");
  await page.context().storageState({ path: "e2e/.auth/owner.json" });
});
