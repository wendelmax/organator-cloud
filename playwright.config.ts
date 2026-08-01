import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/tests",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "e2e/playwright-report" }]],
  use: {
    baseURL: process.env.WEB_URL || "http://localhost:3001",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
