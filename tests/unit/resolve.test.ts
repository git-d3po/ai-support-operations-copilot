import { describe, expect, it } from "vitest";
import { resolveOutcome } from "@/lib/orchestrator/resolve";
import { makeClassification } from "./testSupport/fixtures";
import { EscalationDecisionSchema, ResolutionDecisionSchema, type AnyAgentFinding } from "@/lib/ai/schemas";
import { degradedRiskFinding } from "@/lib/orchestrator/agents/fallback";

function billingFinding(overrides: Partial<AnyAgentFinding> = {}): AnyAgentFinding {
  return {
    agentKey: "billing",
    summary: "billing summary",
    evidence: [],
    confidence: 0.8,
    policyReferences: [],
    flags: [],
    ...overrides,
  };
}

function technicalFinding(overrides: Partial<AnyAgentFinding> = {}): AnyAgentFinding {
  return {
    agentKey: "technical",
    summary: "technical summary",
    evidence: [],
    confidence: 0.8,
    policyReferences: [],
    flags: [],
    ...overrides,
  };
}

function policyFinding(decision: "approve" | "deny" | "requires_review" | null, overrides = {}) {
  return {
    agentKey: "policy" as const,
    summary: "policy summary",
    evidence: [],
    confidence: 0.8,
    policyReferences: [],
    flags: [],
    policyDecision: decision
      ? {
          applicablePolicy: { slug: "refund-policy", title: "Refund Policy" },
          decision,
          justification: "because policy says so",
          conditionsMet: [],
          conditionsUnmet: [],
        }
      : null,
    ...overrides,
  };
}

function riskFinding(escalationRecommended: boolean, overrides = {}) {
  return {
    agentKey: "risk" as const,
    summary: "risk summary",
    evidence: [],
    confidence: 0.8,
    policyReferences: [],
    flags: [],
    escalationRecommended,
    escalationReason: escalationRecommended ? "suspicious activity" : null,
    targetTeam: escalationRecommended ? ("trust_and_safety" as const) : null,
    severity: escalationRecommended ? ("critical" as const) : null,
    ...overrides,
  };
}

describe("resolveOutcome", () => {
  it("escalates when classification itself failed, regardless of findings", () => {
    const { resolution, escalation } = resolveOutcome(makeClassification(), true, [
      policyFinding("approve"),
    ]);
    expect(resolution.action).toBe("escalate");
    expect(escalation?.required).toBe(true);
  });

  it("escalates when Risk recommends it, even if Policy approved", () => {
    const { resolution, escalation } = resolveOutcome(makeClassification(), false, [
      policyFinding("approve"),
      riskFinding(true),
    ]);
    expect(resolution.action).toBe("escalate");
    expect(escalation?.targetTeam).toBe("trust_and_safety");
    expect(escalation?.severity).toBe("critical");
  });

  it("refunds the customer when Policy approves", () => {
    const { resolution, escalation } = resolveOutcome(makeClassification(), false, [
      billingFinding({ flags: ["duplicate_charge_confirmed"] }),
      policyFinding("approve"),
    ]);
    expect(resolution.action).toBe("refund_customer");
    expect(escalation).toBeNull();
  });

  it("denies the request when Policy denies", () => {
    const { resolution } = resolveOutcome(makeClassification(), false, [policyFinding("deny")]);
    expect(resolution.action).toBe("deny_request");
  });

  it("escalates to billing_ops when Policy requires review", () => {
    const { resolution, escalation } = resolveOutcome(makeClassification(), false, [
      policyFinding("requires_review"),
    ]);
    expect(resolution.action).toBe("escalate");
    expect(escalation?.targetTeam).toBe("billing_ops");
  });

  it("escalates to billing_ops when Policy ran but couldn't reach a decision (null)", () => {
    const { resolution, escalation } = resolveOutcome(makeClassification(), false, [policyFinding(null)]);
    expect(resolution.action).toBe("escalate");
    expect(escalation?.targetTeam).toBe("billing_ops");
  });

  it("escalates to engineering when Technical says requires_escalation", () => {
    const { resolution, escalation } = resolveOutcome(makeClassification(), false, [
      technicalFinding({ flags: ["requires_escalation"] }),
    ]);
    expect(resolution.action).toBe("escalate");
    expect(escalation?.targetTeam).toBe("engineering");
  });

  it("auto-resolves when Technical says the standard flow applies", () => {
    const { resolution } = resolveOutcome(makeClassification(), false, [
      technicalFinding({ flags: ["auto_resolvable"] }),
    ]);
    expect(resolution.action).toBe("auto_resolve");
  });

  it("replies and closes when Technical has a known-issue workaround", () => {
    const { resolution } = resolveOutcome(makeClassification(), false, [
      technicalFinding({ flags: ["known_issue_workaround_available"] }),
    ]);
    expect(resolution.action).toBe("reply_and_close");
  });

  it("replies and monitors when Billing says payment failed awaiting customer action", () => {
    const { resolution } = resolveOutcome(makeClassification(), false, [
      billingFinding({ flags: ["payment_failed_awaiting_customer_action"] }),
    ]);
    expect(resolution.action).toBe("reply_and_monitor");
  });

  it("escalates conservatively when a selected agent failed and nothing else decided", () => {
    const { resolution } = resolveOutcome(makeClassification(), false, [
      billingFinding({ flags: ["agent_failed"] }),
    ]);
    expect(resolution.action).toBe("escalate");
    expect(resolution.requiresHumanReview).toBe(true);
  });

  it("replies and monitors when no specialist agents ran at all", () => {
    const { resolution, escalation } = resolveOutcome(makeClassification(), false, []);
    expect(resolution.action).toBe("reply_and_monitor");
    expect(escalation).toBeNull();
  });

  it("defaults to reply_and_close when overall confidence is high with no other signal", () => {
    const { resolution } = resolveOutcome(makeClassification(), false, [
      technicalFinding({ confidence: 0.9 }),
    ]);
    expect(resolution.action).toBe("reply_and_close");
    expect(resolution.requiresHumanReview).toBe(false);
  });

  it("defaults to reply_and_monitor when overall confidence is low with no other signal", () => {
    const { resolution } = resolveOutcome(makeClassification(), false, [
      technicalFinding({ confidence: 0.3 }),
    ]);
    expect(resolution.action).toBe("reply_and_monitor");
    expect(resolution.requiresHumanReview).toBe(true);
  });

  it("ignores the response agent's own finding when aggregating (it isn't investigative evidence)", () => {
    const { resolution } = resolveOutcome(makeClassification(), false, [
      { agentKey: "response", summary: "x", evidence: [], confidence: 0.99, policyReferences: [], flags: [] },
    ]);
    // Only a response finding present -> treated as "no specialist agents ran".
    expect(resolution.action).toBe("reply_and_monitor");
  });
});

// Account Security Policy (pre-live): reports of suspicious account activity
// "must always be escalated to Trust & Safety" and must not be resolved
// directly ("Security always escalates, regardless of other findings").
// resolveOutcome() used to leave both whether and where to escalate to the
// Risk agent's model output; it now enforces them for the account_security
// intent. Severity is deliberately not redefined by this rule.
describe("resolveOutcome: account_security mandatory escalation to Trust & Safety", () => {
  const accountSecurity = () => makeClassification({ intent: "account_security", confidence: 0.77 });
  const expectMandatory = (result: ReturnType<typeof resolveOutcome>) => {
    expect(result.resolution.action).toBe("escalate");
    expect(result.resolution.requiresHumanReview).toBe(true);
    expect(result.escalation?.required).toBe(true);
    expect(result.escalation?.targetTeam).toBe("trust_and_safety");
  };

  it("escalates to Trust & Safety when Risk recommends escalation, keeping Risk's severity", () => {
    const result = resolveOutcome(accountSecurity(), false, [riskFinding(true)]);
    expectMandatory(result);
    expect(result.escalation?.severity).toBe("critical");
    expect(result.escalation?.reason).toContain("suspicious activity");
  });

  it("still escalates to Trust & Safety when Risk does NOT recommend escalation", () => {
    for (const confidence of [0.9, 0.4]) {
      expectMandatory(resolveOutcome(accountSecurity(), false, [riskFinding(false, { confidence })]));
    }
  });

  it("still escalates when no Risk finding is present at all", () => {
    expectMandatory(resolveOutcome(accountSecurity(), false, []));
  });

  it("overrides the target when Risk chooses another team, and when Risk's target is null", () => {
    for (const targetTeam of ["senior_support", "engineering", "billing_ops", null] as const) {
      const result = resolveOutcome(accountSecurity(), false, [riskFinding(true, { targetTeam })]);
      expectMandatory(result);
    }
  });

  it("escalates to Trust & Safety when the Risk step itself failed (its fallback names senior_support)", () => {
    const failed = degradedRiskFinding("bad json");
    expect(failed.targetTeam).toBe("senior_support"); // the model-independent fallback the invariant must override
    expectMandatory(resolveOutcome(accountSecurity(), false, [failed]));
  });

  it("holds regardless of Technical, Policy or Billing findings, including ones that would decide the outcome", () => {
    const others: AnyAgentFinding[][] = [
      [technicalFinding({ flags: ["auto_resolvable"] })],
      [technicalFinding({ flags: ["requires_escalation"] })],
      [policyFinding("approve")],
      [policyFinding("deny")],
      [billingFinding({ flags: ["payment_failed_awaiting_customer_action"] })],
    ];
    for (const findings of others) {
      expectMandatory(resolveOutcome(accountSecurity(), false, [riskFinding(false), ...findings]));
    }
  });

  it("does not redefine severity: Risk's is kept when supplied, otherwise the project's existing Risk-escalation default", () => {
    expect(resolveOutcome(accountSecurity(), false, [riskFinding(true, { severity: "low" })]).escalation?.severity).toBe("low");
    // the same default rule 2 applies to a Risk escalation with no severity
    expect(resolveOutcome(accountSecurity(), false, [riskFinding(false)]).escalation?.severity).toBe("medium");
    expect(resolveOutcome(accountSecurity(), false, []).escalation?.severity).toBe("medium");
    expect(
      resolveOutcome(makeClassification({ intent: "refund_request" }), false, [riskFinding(true, { severity: null })]).escalation?.severity,
    ).toBe("medium");
  });

  it("grounds the escalation in account-security-policy deterministically, not via any Risk citation", () => {
    const cases = [
      [riskFinding(true, { policyReferences: [] })],
      [riskFinding(true, { policyReferences: [{ slug: "escalation-policy", title: "Escalation Policy" }] })],
      [riskFinding(false)],
      [],
    ];
    for (const findings of cases) {
      const { resolution, escalation } = resolveOutcome(accountSecurity(), false, findings as AnyAgentFinding[]);
      expect(escalation?.reason).toContain("account-security-policy");
      expect(resolution.summary).toContain("account-security-policy");
    }
  });

  it("stays within the schema limits even for a maximum-length Risk reason", () => {
    const result = resolveOutcome(accountSecurity(), false, [riskFinding(true, { escalationReason: "x".repeat(400) })]);
    expect(EscalationDecisionSchema.safeParse(result.escalation).success).toBe(true);
    expect(ResolutionDecisionSchema.safeParse(result.resolution).success).toBe(true);
    expect(result.escalation?.reason).toContain("account-security-policy"); // the citation is never the part that gets cut
  });

  it("keeps the classification-failure precedence: a failed classification still goes to senior_support", () => {
    const result = resolveOutcome(accountSecurity(), true, [riskFinding(true)]);
    expect(result.resolution.action).toBe("escalate");
    expect(result.escalation?.targetTeam).toBe("senior_support");
    expect(result.escalation?.reason).toMatch(/classification failed/i);
  });

  it("does not change any other intent: a non-recommending Risk still does not escalate, and Risk's own target is respected", () => {
    for (const intent of ["duplicate_charge", "refund_request", "technical_issue", "failed_payment", "general_inquiry", "cancellation"] as const) {
      const quiet = resolveOutcome(makeClassification({ intent }), false, [riskFinding(false)]);
      expect(quiet.escalation).toBeNull();
      const chosen = resolveOutcome(makeClassification({ intent }), false, [riskFinding(true, { targetTeam: "engineering" })]);
      expect(chosen.escalation?.targetTeam).toBe("engineering");
    }
  });
});
