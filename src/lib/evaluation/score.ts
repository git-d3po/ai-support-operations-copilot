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

  const allFindings = outcome.agentResults.map((r) => r.finding);
  const policyFinding = allFindings.find(isPolicyFinding);
  const actualPolicySlug = policyFinding?.policyDecision?.applicablePolicy.slug ?? null;

  // Not every scenario that hinges on a policy expects the Policy Agent
  // itself to run — e.g. a suspected-compromise ticket is expected to be
  // grounded in the Account Security Policy via the RISK agent's citation,
  // not a Policy Agent decision (Policy isn't even in `expectedAgents` for
  // that case). So a match against the Policy Agent's own decision is
  // sufficient but not necessary: if it doesn't match, fall back to
  // checking whether *any* agent cited the expected slug in its
  // (grounding-enforced — see policyAgent.ts/riskAgent.ts) policyReferences
  // before concluding the citation is actually missing.
  const anyAgentCitedExpectedSlug = (slug: string) =>
    allFindings.some((f) => f.policyReferences.some((ref) => ref.slug === slug));

  const policyCorrect =
    expected.expectedPolicySlug === null
      ? null
      : actualPolicySlug === expected.expectedPolicySlug || anyAgentCitedExpectedSlug(expected.expectedPolicySlug);

  const actualEscalation = outcome.escalation !== null;
  const escalationCorrect = actualEscalation === expected.expectedEscalation;

  const resolutionCorrect = outcome.resolution.action === expected.expectedAction;

  const investigativeFindings = allFindings.filter((f) => f.agentKey !== "response");
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
