import { test, expect } from "@playwright/test";

test.describe("Privacidade (LGPD)", () => {
  test("owner muda a preferência de marketing e ela persiste", async ({ page }) => {
    await page.goto("/settings");
    const marketing = page.getByRole("checkbox", { name: "Novidades e comunicações de marketing por e-mail" });
    await expect(marketing).toBeVisible();
    // Parte do estado atual (pode ter ficado ligado numa tentativa anterior).
    const initiallyOn = await marketing.isChecked();

    await marketing.setChecked(!initiallyOn);
    await expect(page.getByRole("status")).toHaveText(
      initiallyOn ? /Preferência desativada/ : "Preferência ativada.",
    );
    await page.reload();
    await expect(marketing).toBeChecked({ checked: !initiallyOn });

    // Volta ao estado original e confirma de novo.
    await marketing.setChecked(initiallyOn);
    await expect(page.getByRole("status")).toBeVisible();
    await page.reload();
    await expect(marketing).toBeChecked({ checked: initiallyOn });
    await expect(page.getByText(/Termos de uso: versão 2026-10/)).toBeVisible();
  });
});
