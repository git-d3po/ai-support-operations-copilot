import {
  isPolicyFinding,
  type AgentKey,
  type EvaluationExpectedOutcome,
  type EvaluationResult,
} from "@/lib/ai/schemas";
import type { OrchestrationOutcome } from "@/lib/orchestrator/orchestrator";

function sameAgentSet(a: AgentKey[], b: AgentKey[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((key) => setB.has(key));
}

/**
 * Compares one real OrchestrationOutcome against a curated scenario's
 * expected outcome — exact-match booleans by design (see EVALUATION.md,
 * "Scoring notes"): these dimensions are meant to be unambiguous per
 * scenario, not fuzzy quality scores.
 */
export function scoreOutcome(
  expected: EvaluationExpectedOutcome,
  outcome: OrchestrationOutcome,
): EvaluationResult {
  const classificationCorrect = outcome.classification.intent === expected.expectedIntent;

  const investigativeAgents = outcome.agentsInvoked.filter((key) => key !== "response");
  const expectedInvestigativeAgents = expected.expectedAgents.filter((key) => key !== "response");
  const routingCorrect = sameAgentSet(investigativeAgents, expectedInvestigativeAgents);

  const policyFinding = outcome.agentResults.map((r) => r.finding).find(isPolicyFinding);
  const actualPolicySlug = policyFinding?.policyDecision?.applicablePolicy.slug ?? null;
  const policyCorrect =
    expected.expectedPolicySlug === null ? null : actualPolicySlug === expected.expectedPolicySlug;

  const actualEscalation = outcome.escalation !== null;
  const escalationCorrect = actualEscalation === expected.expectedEscalation;

  const resolutionCorrect = outcome.resolution.action === expected.expectedAction;

  const investigativeFindings = outcome.agentResults
    .map((r) => r.finding)
    .filter((f) => f.agentKey !== "response");
  const evidenceQuality =
    investigativeFindings.length === 0
      ? 1 // nothing was expected to investigate — vacuously fine
      : investigativeFindings.filter((f) => f.evidence.length > 0 && !f.flags.includes("agent_failed")).length /
        investigativeFindings.length;

  // Escalation and resolution correctness matter most operationally — a
  // wrong escalation call has real cost even if the intent label is
  // slightly off. See EVALUATION.md, "Scoring notes."
  const weights: [boolean | null, number][] = [
    [classificationCorrect, 1],
    [routingCorrect, 1],
    [policyCorrect, policyCorrect === null ? 0 : 1.5],
    [escalationCorrect, 2],
    [resolutionCorrect, 2],
  ];
  const applicable = weights.filter(([value]) => value !== null) as [boolean, number][];
  const totalWeight = applicable.reduce((sum, [, w]) => sum + w, 0) + 1; // +1 for evidenceQuality's own weight
  const weightedCorrect =
    applicable.reduce((sum, [value, w]) => sum + (value ? w : 0), 0) + evidenceQuality;
  const overallScore = totalWeight > 0 ? weightedCorrect / totalWeight : 0;

  const mismatches: string[] = [];
  if (!classificationCorrect) mismatches.push(`intent: expected ${expected.expectedIntent}, got ${outcome.classification.intent}`);
  if (!routingCorrect) mismatches.push(`agents: expected [${expectedInvestigativeAgents.join(", ")}], got [${investigativeAgents.join(", ")}]`);
  if (policyCorrect === false) mismatches.push(`policy: expected ${expected.expectedPolicySlug}, got ${actualPolicySlug}`);
  if (!escalationCorrect) mismatches.push(`escalation: expected ${expected.expectedEscalation}, got ${actualEscalation}`);
  if (!resolutionCorrect) mismatches.push(`action: expected ${expected.expectedAction}, got ${outcome.resolution.action}`);

  return {
    classificationCorrect,
    routingCorrect,
    policyCorrect,
    escalationCorrect,
    resolutionCorrect,
    evidenceQuality,
    overallScore,
    notes: mismatches.length > 0 ? mismatches.join("; ") : "All scored dimensions matched the expected outcome.",
  };
}
