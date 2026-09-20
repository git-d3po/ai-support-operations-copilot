import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { SCENARIOS } from "../../prisma/data/scenarios";

/**
 * The public deployment's initialization, end to end, against an isolated
 * scratch database (DECISIONS.md, "Public deployment: explicit Demo Mode and a
 * guarded initialization"): `npm run db:init:demo` builds the schema and the
 * curated dataset, refuses evaluation databases and databases holding real
 * results, and Demo Mode then runs on it with no API key.
 *
 * SAFETY: every child process gets an explicit DATABASE_URL inside a fresh
 * directory under the OS temp dir, applied last so nothing can override it.
 * None of them can reach the repository's eval.db or dev.db, or the external
 * live-evaluation database. No model credential is used or needed: the key is
 * set to an empty string in every child's environment. It is blanked, not
 * deleted, on purpose: the init children (`prisma migrate deploy` via
 * prisma.config.ts, and prisma/seed.ts) load `.env` through dotenv, which fills
 * in an UNDEFINED variable from the real `.env` but never overrides a defined
 * one, so a deleted key would be re-read from it.
 */
const repoRoot = path.resolve(__dirname, "../..");
const tsx = path.join(repoRoot, "node_modules/.bin/tsx");
const scratchDir = mkdtempSync(path.join(os.tmpdir(), "aisc-demo-deploy-"));
const demoDb = path.join(scratchDir, "demo.db");

function childEnv(databaseUrl: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, DATABASE_URL: databaseUrl };
  env.ANTHROPIC_API_KEY = "";
  delete env.EVAL_DATABASE_URL;
  return env;
}

function runScript(script: string, databaseUrl: string, extra: Record<string, string> = {}) {
  return spawnSync(tsx, [script], { cwd: repoRoot, env: childEnv(databaseUrl, extra), encoding: "utf8", timeout: 120_000 });
}

const initDemo = (databaseUrl = `file:${demoDb}`) => runScript("scripts/initDemoDatabase.ts", databaseUrl);

function openScratch() {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${demoDb}` }) });
}

beforeAll(() => {
  // Safe by construction: a scratch directory that is not, and does not contain, any repository database.
  expect(scratchDir.startsWith(os.tmpdir())).toBe(true);
  expect(demoDb).not.toBe(path.join(repoRoot, "eval.db"));
  expect(demoDb).not.toBe(path.join(repoRoot, "dev.db"));
  expect(existsSync(demoDb)).toBe(false);
});

afterAll(() => {
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("db:init:demo on a fresh database", () => {
  it("applies the migrations and seeds the 11 curated tickets, policies, fixtures and evaluation cases", async () => {
    const result = initDemo();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(demoDb)).toBe(true);

    const db = openScratch();
    try {
      expect(await db.ticket.count({ where: { scenarioKey: { not: null } } })).toBe(SCENARIOS.length);
      expect(await db.evaluationCase.count()).toBe(SCENARIOS.length);
      expect(await db.policy.count()).toBeGreaterThan(0);
      expect(await db.invoice.count()).toBeGreaterThan(0);
      expect(await db.orchestrationRun.count()).toBe(0);
      expect(await db.evaluationResult.count()).toBe(0);
    } finally {
      await db.$disconnect();
    }
  }, 120_000);

  it("leaves Demo Mode usable immediately, with no API key: curated runs replay, uncurated tickets are blocked", () => {
    const result = spawnSync(tsx, ["tests/integration/support/demoDeploymentProbe.ts"], {
      cwd: repoRoot,
      env: childEnv(`file:${demoDb}`, { AI_MODE: "demo" }),
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(result.status, result.stderr).toBe(0);

    const out = JSON.parse(result.stdout.trim().split("\n").at(-1)!);
    expect(out.hadApiKey).toBe(false); // the probe really ran without a credential
    expect(out.first).toMatchObject({ ok: true, replayed: false });
    expect(out.second).toMatchObject({ ok: true, replayed: true }); // idempotent: the same run, not a new one
    expect(out.second.runId).toBe(out.first.runId);
    expect(out.blocked.ok).toBe(false);
    expect(out.blocked.error).toMatch(/curated evaluation scenarios only/);
    expect(out.uncuratedRunCount).toBe(0);
    expect(out.runCount).toBe(1);
    expect(out.runs).toEqual([{ status: "completed", isSimulated: true, providers: ["demo"] }]);
  }, 120_000);

  it("is idempotent: re-initializing a database that holds only simulated runs rebuilds the same dataset", async () => {
    const result = initDemo();
    expect(result.status, result.stderr).toBe(0);

    const db = openScratch();
    try {
      expect(await db.ticket.count({ where: { scenarioKey: { not: null } } })).toBe(SCENARIOS.length);
      expect(await db.orchestrationRun.count()).toBe(0); // the simulated demo run from the previous test was cleared
    } finally {
      await db.$disconnect();
    }
  }, 120_000);
});

describe("db:init:demo refuses anything that could hold live evidence", () => {
  it("refuses a database that already holds a real (non-simulated) run, and deletes nothing", async () => {
    const db = openScratch();
    let realRunId: string;
    try {
      const ticket = await db.ticket.findFirstOrThrow({ where: { scenarioKey: "duplicate-billing" } });
      realRunId = (await db.orchestrationRun.create({ data: { ticketId: ticket.id, status: "completed", isSimulated: false, finishedAt: new Date() } })).id;
    } finally {
      await db.$disconnect();
    }

    const result = initDemo();
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/real \(non-simulated\)/);

    const after = openScratch();
    try {
      expect(await after.orchestrationRun.findUnique({ where: { id: realRunId } })).not.toBeNull();
      expect(await after.ticket.count()).toBeGreaterThan(0); // the seed never ran
    } finally {
      await after.$disconnect();
    }
  }, 120_000);

  it("refuses an evaluation-named database before creating or touching it", () => {
    const evalDb = path.join(scratchDir, "eval-fixture.db");
    const result = initDemo(`file:${evalDb}`);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/evaluation database/);
    expect(existsSync(evalDb)).toBe(false);
  });

  it("refuses when DATABASE_URL is not set, instead of falling back to a default database", () => {
    const env = childEnv("unused");
    delete env.DATABASE_URL;
    const result = spawnSync(tsx, ["scripts/initDemoDatabase.ts"], { cwd: repoRoot, env, encoding: "utf8", timeout: 60_000 });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/DATABASE_URL is not set/);
  });
});

describe("start:demo refuses unsafe targets before initializing or starting anything", () => {
  it("refuses an evaluation database, and creates nothing", () => {
    const evalDb = path.join(scratchDir, "eval.db");
    const result = runScript("scripts/startDemo.ts", `file:${evalDb}`);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/evaluation database/);
    expect(existsSync(evalDb)).toBe(false);
  });

  it("refuses when DATABASE_URL is not set", () => {
    const env = childEnv("unused");
    delete env.DATABASE_URL;
    const result = spawnSync(tsx, ["scripts/startDemo.ts"], { cwd: repoRoot, env, encoding: "utf8", timeout: 60_000 });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/DATABASE_URL is not set/);
  });
});
