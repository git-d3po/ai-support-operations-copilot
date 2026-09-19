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
  // The app's SQLite database (see DECISIONS.md, "Database: SQLite +
  // Prisma 7") is a single file with no connection pooling — concurrent
  // "Run AI analysis" writes from parallel test workers risk SQLITE_BUSY.
  // One worker keeps the suite reliable at this project's scale; a
  // Postgres-backed setup wouldn't need this.
  workers: 1,
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
    // Reseed before every fresh server boot so "Run AI analysis" tests can
    // assume a pristine (never-analyzed) starting state — see
    // runAnalysis.spec.ts. Skipped only if `reuseExistingServer` reuses an
    // already-running server (fine for fast local iteration; CI always
    // starts fresh).
    command: "npm run db:seed && npm run build && npm run start -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // See instrumentation.ts / e2eMockProvider.ts / DECISIONS.md: swaps the
    // "anthropic" provider for a deterministic fixture so "Run AI analysis"
    // can be tested end to end without a live API key or a network call.
    env: { USE_MOCK_MODEL_PROVIDER: "true" },
  },
});
