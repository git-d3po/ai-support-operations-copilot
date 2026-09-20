/**
 * `npm run eval:dry-run` — validates the evaluation pipeline end to end
 * (orchestrator → persistence → scorer → UI) against a deterministic
 * fixture provider covering all 11 curated scenarios. NEVER uses or
 * requires a real ANTHROPIC_API_KEY.
 *
 * This is a harness-validation tool, not a measurement of AI quality —
 * see DECISIONS.md ("Evaluation dry-run fixture: validating the harness,
 * not the model") and EVALUATION.md. Every result this writes is tagged
 * `isSimulated: true` (via persistOrchestrationRun's provider-provenance
 * tracking) and is rendered distinctly from a live result everywhere in
 * the app.
 */
import "dotenv/config";
import { registerProvider, _resetProvidersForTests } from "../src/lib/ai/providers/registry";
import { MockProvider } from "../src/lib/ai/providers/mock";
import { runEvaluationSuite } from "../src/lib/evaluation/runEvaluation";
import { FIXTURES, scenarioKeyForTicketSummary, taskForSystemPrompt } from "./evaluationDryRunFixtures";
import type { CompletionRequest, CompletionResult } from "../src/lib/ai/providers/types";

function respond(request: CompletionRequest): CompletionResult {
  const task = taskForSystemPrompt(request.system);
  const userMessage = request.messages.at(-1)?.content ?? "";
  const scenarioKey = scenarioKeyForTicketSummary(userMessage);

  if (!task || !scenarioKey) {
    throw new Error(
      `evaluationDryRunFixtures: could not identify task/scenario for this call (task=${task}, scenarioKey=${scenarioKey}). ` +
        `First line of user message: ${userMessage.split("\n")[0]}`,
    );
  }

  const text = FIXTURES[scenarioKey]?.[task];
  if (!text) {
    throw new Error(
      `evaluationDryRunFixtures: no fixture for scenario "${scenarioKey}" task "${task}". ` +
        `This means the real routing logic invoked an agent this scenario's fixture set didn't anticipate — ` +
        `a genuine finding, not a fixture gap to silently paper over.`,
    );
  }
  // Token counts are nominal placeholders — clearly not real usage, since
  // this call was never actually sent to a model. Cost/latency in the
  // resulting AgentInvocation rows are similarly nominal; both are
  // honestly labeled via provider="mock"/isSimulated, never presented as
  // real usage.
  return { text, inputTokens: 100, outputTokens: 50 };
}

async function main() {
  console.log("=".repeat(72));
  console.log("EVALUATION DRY RUN — deterministic fixture provider, NOT a live model.");
  console.log("Results validate the pipeline/scorer wiring only. See DECISIONS.md.");
  console.log("=".repeat(72));

  _resetProvidersForTests();
  registerProvider("anthropic", new MockProvider(respond));

  // Optional: `npm run eval:dry-run -- <scenarioKey>` runs just that scenario.
  const summaries = await runEvaluationSuite({ scenarioKey: process.argv[2] });

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
      `${summary.passed ? "✓" : "✗"} ${summary.scenarioKey}: overall score ${summary.overallScore?.toFixed(2)} ` +
        `(${summary.passed ? "pass" : "fail"}) [SIMULATED=${summary.isSimulated}]`,
    );
  }

  console.log("=".repeat(72));
  console.log(
    `${passCount} passed, ${failCount} failed, ${erroredCount} did not run, out of ${summaries.length} scenarios.`,
  );
  console.log("These are SIMULATED results (deterministic fixture provider) — not a real evaluation.");
  console.log("=".repeat(72));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
