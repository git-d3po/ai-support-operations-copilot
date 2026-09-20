/**
 * CLI entry point for the evaluation suite — `npm run eval`.
 *
 * Refuses to run without a real ANTHROPIC_API_KEY, on purpose: this suite
 * calls the real orchestrator, which calls the real model provider for
 * every curated scenario. Running it against MockProvider would produce
 * "evaluation results" that only reflect canned test fixtures, not actual
 * model behavior — exactly the "invented performance metric" this
 * project's evaluation design explicitly avoids. See EVALUATION.md.
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { assertLiveModeForEvaluation } from "../src/lib/ai/mode";

/**
 * Live evaluation results go to their OWN database (`eval.db` by default),
 * never the dev/e2e database (`dev.db`), because `npm run test:e2e` reseeds
 * `dev.db` and would destroy them. Override with EVAL_DATABASE_URL. Create
 * it with `npm run db:eval:setup`; view it with `npm run dev:eval`. See
 * DECISIONS.md ("Live evaluation runs against a separate database").
 */
const EVAL_DATABASE_URL = process.env.EVAL_DATABASE_URL ?? "file:./eval.db";

async function main() {
  // First check, before the database or the key: Demo Mode's recordings are
  // scripted, so an evaluation run under AI_MODE=demo must never happen (its
  // results would look like a measurement and are not). An invalid AI_MODE is
  // refused too. See DECISIONS.md ("Public Demo Mode").
  try {
    assertLiveModeForEvaluation();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  // Must happen before anything imports src/lib/db.ts (which reads
  // DATABASE_URL at import time) — hence the dynamic import below.
  process.env.DATABASE_URL = EVAL_DATABASE_URL;

  if (EVAL_DATABASE_URL.startsWith("file:")) {
    const file = path.resolve(EVAL_DATABASE_URL.slice("file:".length));
    if (!existsSync(file)) {
      console.error(
        `Evaluation database not found at ${file}. Create and seed it first with: npm run db:eval:setup`,
      );
      process.exitCode = 1;
      return;
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. The evaluation suite makes real model calls through the " +
        "configured provider for every curated scenario — set ANTHROPIC_API_KEY in .env before running it.",
    );
    process.exitCode = 1;
    return;
  }

  // Optional: `npm run eval -- <scenarioKey>` runs exactly one scenario
  // (through the same analyzeTicket() path); no argument runs all of them.
  const scenarioKey = process.argv[2];
  const { runEvaluationSuite } = await import("../src/lib/evaluation/runEvaluation");

  console.log(`Evaluation database: ${EVAL_DATABASE_URL}`);
  console.log(
    `Running ${scenarioKey ? `scenario "${scenarioKey}"` : "the evaluation suite"} against the live provider configured in modelRouting.ts...\n`,
  );
  const summaries = await runEvaluationSuite({ scenarioKey });

  let passCount = 0;
  let failCount = 0;
  let erroredCount = 0;

  for (const summary of summaries) {
    if (!summary.ok) {
      erroredCount++;
      console.log(`✗ ${summary.scenarioKey}: FAILED TO RUN — ${summary.error}`);
      continue;
    }
    if (summary.passed) passCount++;
    else failCount++;
    console.log(
      `${summary.passed ? "✓" : "✗"} ${summary.scenarioKey}: overall score ${summary.overallScore?.toFixed(2)} (${summary.passed ? "pass" : "fail"})`,
    );
  }

  console.log(`\n${passCount} passed, ${failCount} failed, ${erroredCount} did not run, out of ${summaries.length} scenarios.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
