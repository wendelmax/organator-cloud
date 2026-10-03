import { test, expect, request } from "@playwright/test";

const API_URL = process.env.E2E_API_URL ?? "http://localhost:3000";

// Créditos (#95): o admin da plataforma concede pela API e o owner do tenant
// vê o saldo e o lançamento no billing (ledger no Postgres real).
test.describe("Créditos do tenant", () => {
  test("crédito concedido aparece no billing do tenant", async ({ page }) => {
    const api = await request.newContext({ baseURL: API_URL });
    const login = await api.post("/v1/auth/login", {
      data: { email: "ops@organator.app", password: "Ops12345!" },
    });
    expect(login.ok()).toBeTruthy();
    const { access_token } = await login.json();
    const headers = { Authorization: `Bearer ${access_token}` };

    const tenants = await (await api.get("/v1/tenants", { headers })).json();
    const acme = tenants.find((t: { slug: string }) => t.slug === "acme");
    const reason = `E2E cortesia ${Date.now()}`;
    const granted = await api.post(`/v1/billing/tenants/${acme.id}/credits`, {
      headers,
      data: { amount: 2500, reason, currency: "usd" },
    });
    expect(granted.status()).toBe(201);
    await api.dispose();

    await page.goto("/billing");
    await expect(page.getByText("Créditos", { exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(reason))).toBeVisible();
  });
});
