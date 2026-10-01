import { defineConfig } from "@playwright/test";

const OWNER_STATE = "e2e/.auth/owner.json";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "e2e/playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "e2e/playwright-report" }]],
  use: {
    baseURL: process.env.WEB_URL || "http://localhost:3001",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Login do owner (seed em e2e/seed.mjs) salvo para os testes autenticados.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "public",
      testMatch: /tests\/(auth|public)\.spec\.ts/,
    },
    {
      name: "authenticated",
      testMatch: /tests\/.*\.spec\.ts/,
      testIgnore: /tests\/(auth|public)\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: OWNER_STATE },
    },
  ],
});
