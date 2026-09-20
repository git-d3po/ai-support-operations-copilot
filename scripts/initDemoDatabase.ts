/**
 * Deployment initialization for the public Demo Mode deployment:
 * `DATABASE_URL=file:./demo.db npm run db:init:demo`.
 *
 * Applies the committed Prisma migrations and then runs the deterministic seed
 * (prisma/seed.ts), so a fresh deployment has the schema, the 11 curated demo
 * tickets, policies, fixtures and evaluation cases, and Demo Mode is usable
 * immediately. It is non-interactive (`prisma migrate deploy`, not
 * `migrate dev`) and idempotent: re-running it rebuilds the same dataset.
 *
 * The seed CLEARS its target first, so this script is deliberately guarded
 * (see src/lib/deploy/demoDeployment.ts and DECISIONS.md):
 *  - DATABASE_URL must be set explicitly; there is no default database;
 *  - it refuses evaluation databases by name (eval*.db, EVAL_DATABASE_URL);
 *  - it refuses ANY database that already holds real (non-simulated) runs or
 *    evaluation results, whatever its name, before migrating or seeding.
 * It never reads EVAL_DATABASE_URL to write anything, and never touches eval.db.
 * `npm run db:seed` and the evaluation workflow are unchanged.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { assertSafeDemoDatabaseUrl } from "../src/lib/deploy/demoDeployment";

const cwd = process.cwd();
const bin = (name: string) => path.join(cwd, "node_modules/.bin", name);

/** Counts real (non-simulated) runs and evaluation results already in an existing database, tolerating an unmigrated one. */
async function countRealEvidence(file: string): Promise<number> {
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }) });
  try {
    const tables = (await db.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('OrchestrationRun', 'EvaluationResult')`,
    )).map((row) => row.name);

    let total = 0;
    for (const table of tables) {
      const rows = await db.$queryRawUnsafe<Array<{ n: number | bigint }>>(`SELECT COUNT(*) AS n FROM "${table}" WHERE "isSimulated" = 0`);
      total += Number(rows[0]?.n ?? 0);
    }
    return total;
  } finally {
    await db.$disconnect();
  }
}

function run(label: string, command: string, args: string[]) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? result.signal}).`);
  }
}

async function main() {
  const file = assertSafeDemoDatabaseUrl(process.env, cwd);
  console.log(`Demo database: ${file}`);

  if (existsSync(file)) {
    const realEvidence = await countRealEvidence(file);
    if (realEvidence > 0) {
      throw new Error(
        `Refusing to initialize ${file}: it already holds ${realEvidence} real (non-simulated) run/evaluation record(s). ` +
          "The seed would delete them. Point DATABASE_URL at a fresh file.",
      );
    }
  }

  run("Applying migrations (prisma migrate deploy)", bin("prisma"), ["migrate", "deploy"]);
  run("Seeding the deterministic dataset (prisma/seed.ts)", bin("tsx"), ["prisma/seed.ts"]);
  console.log("\nDemo database ready.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
