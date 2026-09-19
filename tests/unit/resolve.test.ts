import { describe, expect, it } from "vitest";
import { resolveOutcome } from "@/lib/orchestrator/resolve";
import { makeClassification } from "./testSupport/fixtures";
import type { AnyAgentFinding } from "@/lib/ai/schemas";

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
