import { test as setup } from "@playwright/test";
import { loginAs } from "./helpers";

// Sessões reaproveitadas pelos testes (usuários criados por e2e/seed.mjs).
setup("authenticate as tenant owner", async ({ page }) => {
  await loginAs(page, "owner@organator.app", "Owner1234!");
  await page.context().storageState({ path: "e2e/.auth/owner.json" });
});

setup("authenticate as platform admin", async ({ page }) => {
  await loginAs(page, "ops@organator.app", "Ops12345!");
  await page.context().storageState({ path: "e2e/.auth/admin.json" });
});
