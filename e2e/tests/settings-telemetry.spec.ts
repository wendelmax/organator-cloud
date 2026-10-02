import { test, expect } from "@playwright/test";

// O card mostrava "CLOSED (Normal)" fixo para três provedores, para qualquer usuário.
test.describe("Telemetria do provisioner — admin da plataforma", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("mostra as contagens reais da fila", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Fila do provisioner")).toBeVisible();
    for (const label of ["Na fila", "Em execução", "Concluídos", "Falharam"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText("CLOSED (Normal)")).toHaveCount(0);
  });
});

test.describe("Telemetria do provisioner — owner de tenant", () => {
  test("não vê a telemetria da plataforma", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
    await expect(page.getByText("Fila do provisioner")).toHaveCount(0);
  });
});
