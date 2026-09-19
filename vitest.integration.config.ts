import { defineConfig } from "vitest/config";

/**
 * Separate from vitest.config.ts (unit tests) on purpose: integration
 * tests touch the real local SQLite database via the shared Prisma client
 * (src/lib/db.ts) — see CLAUDE.md, "Unit tests... no database." Keeping
 * them in a different npm script (`test:integration`) means `npm run
 * test` stays fast and DB-free.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    // Integration tests share one SQLite file via a single connection;
    // running them concurrently across files risks lock contention.
    fileParallelism: false,
  },
});
