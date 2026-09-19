import { describe, expect, it } from "vitest";
import { scoreOutcome } from "@/lib/evaluation/score";
import type { EvaluationExpectedOutcome } from "@/lib/ai/schemas";
import type { OrchestrationOutcome } from "@/lib/orchestrator/orchestrator";

function expectedOutcome(overrides: Partial<EvaluationExpectedOutcome> = {}): EvaluationExpectedOutcome {
  return {
    expectedIntent: "duplicate_charge",
    expectedAgents: ["billing", "policy", "response"],
    expectedPolicySlug: "duplicate-charge-policy",
    expectedEscalation: false,
    expectedAction: "refund_customer",
    notes: "test",
    ...overrides,
  };
}

function fullyCorrectOutcome(): OrchestrationOutcome {
  return {
    classification: {
      intent: "duplicate_charge",
      domains: ["billing", "policy"],
      sentiment: "frustrated",
      confidence: 0.9,
      summary: "x",
      keyEvidence: [],
    },
    classificationFailed: false,
    classificationMetrics: { model: "m", inputTokens: 1, outputTokens: 1, latencyMs: 1, estimatedCostUsd: 0 },
    agentsInvoked: ["billing", "policy", "response"],
    agentResults: [
      {
        finding: {
          agentKey: "billing",
          summary: "x",
          evidence: ["duplicate found"],
          confidence: 0.9,
          policyReferences: [],
          flags: [],
        },
        metrics: { model: "m", latencyMs: 1 },
      },
      {
        finding: {
          agentKey: "policy",
          summary: "x",
          evidence: ["policy applies"],
          confidence: 0.9,
          policyReferences: [],
          flags: [],
          policyDecision: {
            applicablePolicy: { slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" },
            decision: "approve",
            justification: "x",
            conditionsMet: [],
            conditionsUnmet: [],
          },
        },
        metrics: { model: "m", latencyMs: 1 },
      },
      {
        finding: { agentKey: "response", summary: "x", evidence: [], confidence: 0.9, policyReferences: [], flags: [] },
        metrics: { model: "m", latencyMs: 1 },
        response: { body: "x", tone: "neutral", nextSteps: [] },
      },
    ],
    resolution: { action: "refund_customer", summary: "x", confidence: 0.9, requiresHumanReview: false },
    escalation: null,
    response: { body: "x", tone: "neutral", nextSteps: [] },
  };
}

describe("scoreOutcome", () => {
  it("scores every dimension correct when the outcome matches expectations exactly", () => {
    const result = scoreOutcome(expectedOutcome(), fullyCorrectOutcome());
    expect(result.classificationCorrect).toBe(true);
    expect(result.routingCorrect).toBe(true);
    expect(result.policyCorrect).toBe(true);
    expect(result.escalationCorrect).toBe(true);
    expect(result.resolutionCorrect).toBe(true);
    expect(result.evidenceQuality).toBe(1);
    expect(result.overallScore).toBeCloseTo(1);
  });

  it("flags a classification mismatch without affecting routing/resolution scoring", () => {
    const outcome = fullyCorrectOutcome();
    outcome.classification.intent = "billing_question";
    const result = scoreOutcome(expectedOutcome(), outcome);
    expect(result.classificationCorrect).toBe(false);
    expect(result.routingCorrect).toBe(true);
    expect(result.notes).toContain("intent");
  });

  it("flags a routing mismatch when a different agent set ran", () => {
    const outcome = fullyCorrectOutcome();
    outcome.agentsInvoked = ["billing", "technical", "response"];
    const result = scoreOutcome(expectedOutcome(), outcome);
    expect(result.routingCorrect).toBe(false);
  });

  it("treats agent order as irrelevant to routing correctness", () => {
    const outcome = fullyCorrectOutcome();
    outcome.agentsInvoked = ["policy", "billing", "response"];
    const result = scoreOutcome(expectedOutcome(), outcome);
    expect(result.routingCorrect).toBe(true);
  });

  it("flags an incorrect policy citation", () => {
    const outcome = fullyCorrectOutcome();
    const policyFinding = outcome.agentResults[1].finding;
    if ("policyDecision" in policyFinding && policyFinding.policyDecision) {
      policyFinding.policyDecision.applicablePolicy.slug = "refund-policy";
    }
    const result = scoreOutcome(expectedOutcome(), outcome);
    expect(result.policyCorrect).toBe(false);
  });

  it("marks policyCorrect as null (not applicable) when no policy decision was expected", () => {
    const outcome = fullyCorrectOutcome();
    const result = scoreOutcome(expectedOutcome({ expectedPolicySlug: null }), outcome);
    expect(result.policyCorrect).toBeNull();
  });

  it("flags an incorrect escalation call", () => {
    const outcome = fullyCorrectOutcome();
    outcome.escalation = { required: true, reason: "x", targetTeam: "senior_support", severity: "low" };
    const result = scoreOutcome(expectedOutcome({ expectedEscalation: false }), outcome);
    expect(result.escalationCorrect).toBe(false);
  });

  it("flags an incorrect resolution action", () => {
    const outcome = fullyCorrectOutcome();
    outcome.resolution.action = "deny_request";
    const result = scoreOutcome(expectedOutcome(), outcome);
    expect(result.resolutionCorrect).toBe(false);
    expect(result.notes).toContain("action");
  });

  it("penalizes evidence quality when a finding has no evidence", () => {
    const outcome = fullyCorrectOutcome();
    outcome.agentResults[0].finding.evidence = [];
    const result = scoreOutcome(expectedOutcome(), outcome);
    expect(result.evidenceQuality).toBeLessThan(1);
  });

  it("penalizes evidence quality when an agent failed", () => {
    const outcome = fullyCorrectOutcome();
    outcome.agentResults[0].finding.flags = ["agent_failed"];
    const result = scoreOutcome(expectedOutcome(), outcome);
    expect(result.evidenceQuality).toBeLessThan(1);
  });

  it("produces a lower overall score the more dimensions are wrong", () => {
    const allCorrect = scoreOutcome(expectedOutcome(), fullyCorrectOutcome());

    const worse = fullyCorrectOutcome();
    worse.resolution.action = "deny_request";
    worse.escalation = { required: true, reason: "x", targetTeam: "senior_support", severity: "low" };
    const someWrong = scoreOutcome(expectedOutcome(), worse);

    expect(someWrong.overallScore).toBeLessThan(allCorrect.overallScore);
  });

  // Regression coverage for the "suspicious-activity"-style scenario: the
  // expected policy grounding comes from the RISK agent's citation, not a
  // Policy Agent decision — Policy isn't even expected to run. See
  // AUDIT.md, Audit #3, and DECISIONS.md ("Evaluation scorer must accept
  // policy grounding cited by any agent, not only the Policy Agent").
  describe("policy grounding cited by a non-Policy agent (e.g. Risk)", () => {
    function riskOnlyOutcome(riskPolicyReferences: { slug: string; title: string }[]): OrchestrationOutcome {
      return {
        classification: {
          intent: "account_security",
          domains: ["risk"],
          sentiment: "urgent",
          confidence: 0.9,
          summary: "x",
          keyEvidence: [],
        },
        classificationFailed: false,
        classificationMetrics: { model: "m", inputTokens: 1, outputTokens: 1, latencyMs: 1, estimatedCostUsd: 0 },
        agentsInvoked: ["risk", "response"],
        agentResults: [
          {
            finding: {
              agentKey: "risk",
              summary: "Suspected compromise.",
              evidence: ["unrecognized login"],
              confidence: 0.9,
              policyReferences: riskPolicyReferences,
              flags: [],
              escalationRecommended: true,
              escalationReason: "x",
              targetTeam: "trust_and_safety",
              severity: "critical",
            },
            metrics: { model: "m", latencyMs: 1 },
          },
          {
            finding: { agentKey: "response", summary: "x", evidence: [], confidence: 0.9, policyReferences: [], flags: [] },
            metrics: { model: "m", latencyMs: 1 },
            response: { body: "x", tone: "neutral", nextSteps: [] },
          },
        ],
        resolution: { action: "escalate", summary: "x", confidence: 0.9, requiresHumanReview: true },
        escalation: { required: true, reason: "x", targetTeam: "trust_and_safety", severity: "critical" },
        response: { body: "x", tone: "neutral", nextSteps: [] },
      };
    }

    const expected = expectedOutcome({
      expectedIntent: "account_security",
      expectedAgents: ["risk", "response"],
      expectedPolicySlug: "account-security-policy",
      expectedEscalation: true,
      expectedAction: "escalate",
    });

    it("scores policyCorrect=true when Risk (not Policy) cites the expected slug", () => {
      const outcome = riskOnlyOutcome([{ slug: "account-security-policy", title: "Account Security Policy" }]);
      const result = scoreOutcome(expected, outcome);
      expect(result.policyCorrect).toBe(true);
      expect(result.routingCorrect).toBe(true);
    });

    it("scores policyCorrect=false when no agent actually cites the expected slug", () => {
      const outcome = riskOnlyOutcome([]);
      const result = scoreOutcome(expected, outcome);
      expect(result.policyCorrect).toBe(false);
      expect(result.notes).toContain("policy");
    });
  });
});
