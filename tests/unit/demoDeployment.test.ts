import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getAiMode } from "@/lib/ai/mode";
import {
  assertSafeDemoDatabaseUrl,
  buildDemoEnv,
  sqliteFilePath,
  UnsafeDeploymentDatabaseError,
} from "@/lib/deploy/demoDeployment";

/**
 * The deployment boundary of the public Demo Mode deployment (DECISIONS.md,
 * "Public deployment: explicit Demo Mode and a guarded initialization"): the
 * rules the init and start scripts apply, and the committed configuration that
 * wires them. Pure logic and file reads only: no database, no network, no
 * process is started.
 */
const CWD = "/srv/app";

describe("sqliteFilePath", () => {
  it("resolves relative and absolute file: URLs and ignores a query string", () => {
    expect(sqliteFilePath("file:./demo.db", CWD)).toBe("/srv/app/demo.db");
    expect(sqliteFilePath("file:demo.db", CWD)).toBe("/srv/app/demo.db");
    expect(sqliteFilePath("file:/var/data/demo.db", CWD)).toBe("/var/data/demo.db");
    expect(sqliteFilePath("file:./demo.db?connection_limit=1", CWD)).toBe("/srv/app/demo.db");
  });

  it("returns null for anything that is not a SQLite file: URL", () => {
    expect(sqliteFilePath("postgres://localhost/db", CWD)).toBeNull();
    expect(sqliteFilePath("file:", CWD)).toBeNull();
  });
});

describe("assertSafeDemoDatabaseUrl: the initialization target", () => {
  it("accepts an explicit demo database and returns its absolute path", () => {
    expect(assertSafeDemoDatabaseUrl({ DATABASE_URL: "file:./demo.db" }, CWD)).toBe("/srv/app/demo.db");
    expect(assertSafeDemoDatabaseUrl({ DATABASE_URL: "file:/var/data/demo.db" }, CWD)).toBe("/var/data/demo.db");
  });

  it("has no default: an unset or blank DATABASE_URL is refused, so it can never fall back to a local database", () => {
    expect(() => assertSafeDemoDatabaseUrl({}, CWD)).toThrow(UnsafeDeploymentDatabaseError);
    expect(() => assertSafeDemoDatabaseUrl({ DATABASE_URL: "   " }, CWD)).toThrow(/DATABASE_URL is not set/);
  });

  it("refuses a non-SQLite URL", () => {
    expect(() => assertSafeDemoDatabaseUrl({ DATABASE_URL: "postgres://db.example/app" }, CWD)).toThrow(/SQLite file:/);
  });

  it("refuses the repository eval.db, however it is spelled", () => {
    for (const url of ["file:./eval.db", "file:eval.db", "file:/srv/app/eval.db", "file:./sub/../eval.db", "file:./EVAL.DB", "file:./eval.db?x=1"]) {
      expect(() => assertSafeDemoDatabaseUrl({ DATABASE_URL: url }, CWD), url).toThrow(/evaluation database/);
    }
  });

  it("refuses any evaluation-named database, such as the external per-commit live runs", () => {
    expect(() =>
      assertSafeDemoDatabaseUrl({ DATABASE_URL: "file:/home/me/ai-copilot-eval-runs/eval-11-scenarios-1d17378.db" }, CWD),
    ).toThrow(/evaluation database/);
  });

  it("refuses the file EVAL_DATABASE_URL names, even if it is not named eval*", () => {
    const env = { DATABASE_URL: "file:./results.db", EVAL_DATABASE_URL: "file:./results.db" };
    expect(() => assertSafeDemoDatabaseUrl(env, CWD)).toThrow(/EVAL_DATABASE_URL points at the same file/);
    expect(assertSafeDemoDatabaseUrl({ ...env, EVAL_DATABASE_URL: "file:./eval.db" }, CWD)).toBe("/srv/app/results.db");
  });

  it("still allows the local development database name (its content is checked by the script)", () => {
    expect(assertSafeDemoDatabaseUrl({ DATABASE_URL: "file:./dev.db" }, CWD)).toBe("/srv/app/dev.db");
  });
});

/** Next.js's type augmentation makes NODE_ENV mandatory on ProcessEnv; test environments are partial. */
const hostEnv = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

describe("buildDemoEnv: the environment the public server runs with", () => {
  it("forces Demo Mode, whatever the host set, and resolves to demo", () => {
    for (const hostValue of [undefined, "", "live", "demo"]) {
      const env = buildDemoEnv(hostEnv(hostValue === undefined ? {} : { AI_MODE: hostValue }));
      expect(env.AI_MODE).toBe("demo");
      expect(getAiMode(env)).toBe("demo");
    }
  });

  it("blanks ANTHROPIC_API_KEY so a key configured by mistake is invisible to the server", () => {
    const env = buildDemoEnv(hostEnv({ ANTHROPIC_API_KEY: "sk-test-must-be-blanked", DATABASE_URL: "file:./demo.db", PORT: "8080" }));
    // Empty, not deleted: `next start` re-reads a local .env for any UNDEFINED variable, but never overrides a defined one.
    expect(env.ANTHROPIC_API_KEY).toBe("");
    expect(env.DATABASE_URL).toBe("file:./demo.db");
    expect(env.PORT).toBe("8080");
  });

  it("does not mutate the environment it was given (the application default is unchanged)", () => {
    const original = { ANTHROPIC_API_KEY: "sk-test", AI_MODE: "live" };
    buildDemoEnv(hostEnv(original));
    expect(original).toEqual({ ANTHROPIC_API_KEY: "sk-test", AI_MODE: "live" });
    expect(getAiMode({})).toBe("live"); // unset still means live everywhere else
  });
});

const repoRoot = path.resolve(__dirname, "../..");
const readRepoFile = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");
/** The active (non-comment) lines of a TOML-style file. */
const activeLines = (text: string) => text.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

describe("package.json wires the deployment path", () => {
  const pkg = JSON.parse(readRepoFile("package.json")) as {
    scripts: Record<string, string>;
    engines: { node: string };
    dependencies: Record<string, string>;
  };

  it("generates the Prisma client automatically after install (it is gitignored and imported by db.ts)", () => {
    expect(pkg.scripts.postinstall).toBe("prisma generate");
  });

  it("has a dedicated init and start command, and leaves the seed and evaluation commands as they were", () => {
    expect(pkg.scripts["db:init:demo"]).toBe("tsx scripts/initDemoDatabase.ts");
    expect(pkg.scripts["start:demo"]).toBe("tsx scripts/startDemo.ts");
    expect(pkg.scripts["db:seed"]).toBe("tsx prisma/seed.ts");
    expect(pkg.scripts["db:eval:setup"]).toBe("DATABASE_URL=file:./eval.db prisma migrate deploy && DATABASE_URL=file:./eval.db tsx prisma/seed.ts");
    expect(pkg.scripts.start).toBe("next start");
    expect(pkg.scripts.eval).toBe("tsx scripts/runEvaluation.ts");
  });

  it("declares a Node range no wider than Prisma 7 (which better-sqlite3 also supports)", () => {
    expect(pkg.engines.node).toBe("^20.19.0 || ^22.12.0 || >=24.0.0");
  });
});

describe(".replit configures the public demo deployment", () => {
  const replit = activeLines(readRepoFile(".replit"));

  it("builds with dev dependencies (prisma, tsx) and Demo Mode, and starts through start:demo", () => {
    expect(replit).toMatch(/npm ci --include=dev/);
    expect(replit).toMatch(/AI_MODE=demo npm run build/);
    expect(replit).toMatch(/npm run start:demo/);
  });

  it("targets a single instance and the port Next.js listens on by default", () => {
    expect(replit).toMatch(/deploymentTarget = "gce"/);
    expect(replit).toMatch(/localPort = 3000/);
  });

  it("initializes a database that the init guard accepts and that is not an evaluation database", () => {
    const url = replit.match(/DATABASE_URL=(file:\S+)/)?.[1];
    expect(url).toBe("file:./demo.db");
    expect(() => assertSafeDemoDatabaseUrl({ DATABASE_URL: url }, repoRoot)).not.toThrow();
    expect(sqliteFilePath(url!, repoRoot)).not.toBe(path.join(repoRoot, "eval.db"));
  });

  it("never configures an Anthropic key or live mode", () => {
    expect(replit).not.toMatch(/ANTHROPIC_API_KEY/);
    expect(replit).not.toMatch(/AI_MODE=live/);
  });
});
