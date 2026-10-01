import { test, expect } from "@playwright/test";

test.describe("Planos", () => {
  test("owner vê o plano atual do tenant no billing", async ({ page }) => {
    await page.goto("/billing");
    await expect(page.getByText("Assinatura Atual")).toBeVisible();
    // Tenant "acme" foi criado no plano pro (e2e/seed.mjs).
    await expect(page.getByText("pro", { exact: true })).toBeVisible();
  });

  test.describe("como admin da plataforma", () => {
    test.use({ storageState: "e2e/.auth/admin.json" });

    test("lista os planos cadastrados", async ({ page }) => {
      await page.goto("/billing/plans");
      await expect(page.getByRole("heading", { name: "Planos de Billing" })).toBeVisible();
      for (const plan of ["Free", "Pro", "Enterprise"]) {
        await expect(page.getByRole("heading", { name: plan, exact: true })).toBeVisible();
      }
    });
  });
});
