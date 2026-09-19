import { defineConfig, devices } from "@playwright/test";

/**
 * Deterministic functional/regression layer for the app — see
 * ARCHITECTURE.md ("Why Playwright for regression, native browser for
 * exploration"). Runs against a production build on a fixed port so tests
 * aren't sensitive to dev-server compile timing, using the seeded
 * (deterministic) database so assertions can reference specific tickets.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run build && npm run start -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
