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
import { runEvaluationSuite } from "../src/lib/evaluation/runEvaluation";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "ANTHROPIC_API_KEY is not set. The evaluation suite makes real model calls through the " +
        "configured provider for every curated scenario — set ANTHROPIC_API_KEY in .env before running it.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("Running the evaluation suite against the live provider configured in modelRouting.ts...\n");
  const summaries = await runEvaluationSuite();

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
  console.error(error);
  process.exitCode = 1;
});
