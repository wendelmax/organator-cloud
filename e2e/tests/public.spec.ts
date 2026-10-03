import { test, expect } from "@playwright/test";
import { acceptConsentAndEnter } from "../helpers";

test.describe("Páginas públicas", () => {
  test("página de cadastro renderiza wizard de 2 passos", async ({ page }) => {
    await page.goto("/register");
    await expect(page.getByText("Comece a usar o Organator hoje.")).toBeVisible();
    await expect(page.getByText("Crie sua Conta")).toBeVisible();

    await page.getByPlaceholder("Ex: John").fill("John");
    await page.getByPlaceholder("Ex: Doe").fill("Doe");
    await page.getByPlaceholder("john@empresa.com").fill("john@empresa.com");
    await page.getByPlaceholder("Ex: Acme Corp").fill("Acme Corp");
    await page.getByRole("button", { name: "Continuar para Planos" }).click();

    await expect(page.getByText("Escolha um Plano")).toBeVisible();
    await expect(page.getByText("Pro", { exact: true })).toBeVisible();
    await expect(page.getByText("Enterprise", { exact: true })).toBeVisible();
    // Preços vêm dos planos cadastrados (e2e/seed.mjs), os mesmos cobrados no checkout.
    await expect(page.getByText(/US\$\s49,00\/mês/)).toBeVisible();
    await expect(page.getByText(/US\$\s199,00\/mês/)).toBeVisible();
    // Plano pago pré-selecionado vai ao Stripe; o gratuito aparece como "Grátis".
    await expect(page.getByText("Free", { exact: true })).toBeVisible();
    await expect(page.getByText("Grátis", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pagar via Stripe" })).toBeEnabled();
  });

  test("viewer de documentação (Redoc) renderiza", async ({ page }) => {
    await page.goto("/docs/svc-payment");
    await expect(page.getByText("Organator - API Reference")).toBeVisible();
    await expect(page.getByRole("link", { name: "Área do Desenvolvedor" })).toBeVisible();
  });
});

// Fluxo completo do plano gratuito: cadastro -> e-mail de ativação (Mailpit) ->
// senha definida -> login.
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

async function waitForActivationLink(to: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const { messages = [] } = (await res.json()) as { messages?: { ID: string }[] };
    if (messages[0]) {
      const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string };
      const link = /https?:\/\/\S+\/reset-password\?token=[\w-]+/.exec(message.Text)?.[0];
      if (link) return link;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no activation e-mail for ${to}`);
}

test.describe("Cadastro no plano gratuito", () => {
  test("cria a organização, ativa a conta pelo e-mail e entra", async ({ page }) => {
    const suffix = Date.now();
    const email = `free${suffix}@empresa.com`;
    const password = "Gratis1234!";

    await page.goto("/register");
    await page.getByPlaceholder("Ex: John").fill("Free");
    await page.getByPlaceholder("Ex: Doe").fill("User");
    await page.getByPlaceholder("john@empresa.com").fill(email);
    await page.getByPlaceholder("Ex: Acme Corp").fill(`Free Org ${suffix}`);
    await page.getByRole("button", { name: "Continuar para Planos" }).click();

    await page.getByText("Free", { exact: true }).click();
    await page.getByRole("button", { name: "Criar conta grátis" }).click();
    await expect(page.getByText(/Conta criada!/)).toBeVisible();

    await page.goto(await waitForActivationLink(email));
    await page.getByLabel("Nova senha", { exact: true }).fill(password);
    await page.getByLabel("Confirme a nova senha").fill(password);
    await page.getByRole("button", { name: "Definir senha" }).click();
    await expect(page.getByText(/Senha definida/)).toBeVisible();

    await page.goto("/login");
    await page.getByPlaceholder("admin@organator.app").fill(email);
    await page.getByPlaceholder("••••••••").fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await acceptConsentAndEnter(page);
  });
});
