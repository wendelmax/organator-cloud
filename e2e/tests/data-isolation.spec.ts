import { test, expect } from "@playwright/test";

// Owner do tenant "acme" (seed): o modo de isolamento vem de GET /v1/tenants/data-isolation.
test.describe("Isolamento de dados", () => {
  test("owner vê o modo de isolamento do seu tenant nas configurações", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Isolamento do Data Plane")).toBeVisible();
    await expect(page.getByText("SHARED").first()).toBeVisible();
  });
});
