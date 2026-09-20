import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `npm run eval` must refuse to run under AI_MODE=demo: demo recordings are
 * scripted, so an evaluation under that mode would produce results that look
 * like a measurement and are not. This runs the real script in a child process
 * (it runs main() on import, so it cannot be imported).
 *
 * SAFETY: every child process is pointed at an evaluation database that does
 * NOT exist (EVAL_DATABASE_URL below, applied last so no test can override it).
 * The script's very first check is the mode guard, but if that guard were ever
 * removed the script would next look for its database, find none, and stop
 * before opening anything, contacting a model, or writing a run. These tests
 * therefore cannot touch the real eval.db, or any database, even if the guard
 * regresses. The API key given is a fake sentinel.
 */
const repoRoot = path.resolve(__dirname, "../..");
const tsx = path.join(repoRoot, "node_modules/.bin/tsx");
const script = path.join(repoRoot, "scripts/runEvaluation.ts");
const NONEXISTENT_EVAL_DB = path.join(os.tmpdir(), `aisc-nonexistent-eval-${process.pid}-${Date.now()}.db`);

function runEval(env: Record<string, string>) {
  return spawnSync(tsx, [script], {
    cwd: repoRoot,
    env: { ...process.env, ...env, EVAL_DATABASE_URL: `file:${NONEXISTENT_EVAL_DB}` },
    encoding: "utf8",
    timeout: 60_000,
  });
}

describe("the evaluation-refusal tests are safe by construction", () => {
  it("point at a database that does not exist and is not the real eval.db", () => {
    expect(existsSync(NONEXISTENT_EVAL_DB)).toBe(false);
    expect(path.resolve(NONEXISTENT_EVAL_DB)).not.toBe(path.join(repoRoot, "eval.db"));
    expect(NONEXISTENT_EVAL_DB.startsWith(os.tmpdir())).toBe(true);
  });
});

describe("scripts/runEvaluation.ts and Demo Mode", () => {
  it("refuses under AI_MODE=demo, exits non-zero, and tells the user to use live mode", () => {
    const result = runEval({ AI_MODE: "demo", ANTHROPIC_API_KEY: "sk-test-fake-sentinel" });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/AI_MODE=demo/);
    expect(result.stderr).toMatch(/Unset AI_MODE \(or set AI_MODE=live\)/);
    expect(result.stderr).toMatch(/scripted/);
    // It stopped at the mode check, before the database lookup: nothing about the database was reported.
    expect(result.stderr).not.toMatch(/Evaluation database not found/);
    expect(result.stdout).not.toMatch(/Evaluation database:|Running (scenario|the evaluation suite)/);
  });

  it("refuses an invalid AI_MODE too", () => {
    const result = runEval({ AI_MODE: "Demo", ANTHROPIC_API_KEY: "sk-test-fake-sentinel" });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid AI_MODE/);
    expect(result.stderr).not.toMatch(/Evaluation database not found/);
    expect(result.stdout).not.toMatch(/Running (scenario|the evaluation suite)/);
  });

  it("does not refuse when AI_MODE is unset: it passes the mode check and stops at the (nonexistent) database, so nothing can run", () => {
    const result = runEval({ AI_MODE: "", ANTHROPIC_API_KEY: "sk-test-fake-sentinel" });

    expect(result.status).toBe(1);
    expect(result.stderr).not.toMatch(/AI_MODE/);
    expect(result.stderr).toContain("Evaluation database not found");
    expect(result.stdout).not.toMatch(/Running (scenario|the evaluation suite)/);
    expect(existsSync(NONEXISTENT_EVAL_DB)).toBe(false); // and it created nothing
  });
});
