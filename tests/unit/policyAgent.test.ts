import { afterEach, describe, expect, it } from "vitest";
import { isPolicyFinding } from "@/lib/ai/schemas";
import { policyAgent } from "@/lib/orchestrator/agents/policyAgent";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAccountContext, makeAgentContext, makeClassification } from "./testSupport/fixtures";

afterEach(() => {
  _resetProvidersForTests();
});

const REFUND_POLICY = {
  slug: "refund-policy",
  title: "Refund Policy",
  category: "refunds",
  body: "Refunds are approved within 14 days of a charge with minimal usage.",
};

describe("policyAgent", () => {
  it("returns an approve decision with a policy citation", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        policy_agent_finding: JSON.stringify({
          agentKey: "policy",
          summary: "Refund approved — within the 14-day window.",
          evidence: ["Charge occurred 5 days ago"],
          confidence: 0.9,
          policyReferences: [{ slug: "refund-policy", title: "Refund Policy" }],
          flags: [],
          policyDecision: {
            applicablePolicy: { slug: "refund-policy", title: "Refund Policy" },
            decision: "approve",
            justification: "Charge occurred 5 days ago, well within the 14-day window, with no usage since.",
            conditionsMet: ["within 14 days", "minimal usage"],
            conditionsUnmet: [],
          },
        }),
      }),
    );

    const context = makeAgentContext({
      classification: makeClassification({ intent: "refund_request", domains: ["billing"] }),
      accountContext: makeAccountContext({ policies: [REFUND_POLICY] }),
    });

    const result = await policyAgent.run(context);
    const finding = result.finding;
    expect(finding.agentKey).toBe("policy");
    if (isPolicyFinding(finding)) {
      expect(finding.policyDecision?.decision).toBe("approve");
      expect(finding.policyDecision?.applicablePolicy.slug).toBe("refund-policy");
    }
  });

  it("returns a deny decision when conditions aren't met", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        policy_agent_finding: JSON.stringify({
          agentKey: "policy",
          summary: "Refund denied — outside the window with heavy usage.",
          evidence: ["Charge occurred 210 days ago"],
          confidence: 0.9,
          policyReferences: [{ slug: "refund-policy", title: "Refund Policy" }],
          flags: [],
          policyDecision: {
            applicablePolicy: { slug: "refund-policy", title: "Refund Policy" },
            decision: "deny",
            justification: "Charge occurred 210 days ago with acknowledged daily usage.",
            conditionsMet: [],
            conditionsUnmet: ["within 14 days"],
          },
        }),
      }),
    );

    const result = await policyAgent.run(
      makeAgentContext({
        classification: makeClassification({ intent: "refund_request" }),
        accountContext: makeAccountContext({ policies: [REFUND_POLICY] }),
      }),
    );
    if (isPolicyFinding(result.finding)) {
      expect(result.finding.policyDecision?.decision).toBe("deny");
    }
  });

  it("falls back to a null policyDecision (never a fabricated one) on failure", async () => {
    registerProvider("anthropic", createTaskMockProvider({ policy_agent_finding: "not json" }));

    const result = await policyAgent.run(makeAgentContext());
    expect(result.finding.agentKey).toBe("policy");
    if (isPolicyFinding(result.finding)) {
      expect(result.finding.policyDecision).toBeNull();
    }
    expect(result.finding.flags).toContain("agent_failed");
  });

  it("discards a policy decision that cites a slug never actually retrieved (hallucinated citation)", async () => {
    // No policies at all in accountContext -> nothing was retrieved or
    // shown to the model this call, yet it cites "refund-policy" anyway.
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        policy_agent_finding: JSON.stringify({
          agentKey: "policy",
          summary: "Refund approved per policy.",
          evidence: [],
          confidence: 0.9,
          policyReferences: [{ slug: "refund-policy", title: "Refund Policy" }],
          flags: [],
          policyDecision: {
            applicablePolicy: { slug: "refund-policy", title: "Refund Policy" },
            decision: "approve",
            justification: "Within window.",
            conditionsMet: [],
            conditionsUnmet: [],
          },
        }),
      }),
    );

    const result = await policyAgent.run(
      makeAgentContext({
        classification: makeClassification({ intent: "refund_request" }),
        accountContext: makeAccountContext({ policies: [] }),
      }),
    );

    expect(isPolicyFinding(result.finding)).toBe(true);
    if (isPolicyFinding(result.finding)) {
      expect(result.finding.policyDecision).toBeNull();
      expect(result.finding.policyReferences).toEqual([]);
    }
    expect(result.finding.flags).toContain("ungrounded_policy_citation");
    expect(result.finding.confidence).toBe(0);
  });

  it("keeps a grounded decision but strips any additional citation that wasn't retrieved", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        policy_agent_finding: JSON.stringify({
          agentKey: "policy",
          summary: "Refund approved per policy.",
          evidence: [],
          confidence: 0.9,
          policyReferences: [
            { slug: "refund-policy", title: "Refund Policy" },
            { slug: "made-up-policy", title: "Policy That Was Never Retrieved" },
          ],
          flags: [],
          policyDecision: {
            applicablePolicy: { slug: "refund-policy", title: "Refund Policy" },
            decision: "approve",
            justification: "Within window.",
            conditionsMet: [],
            conditionsUnmet: [],
          },
        }),
      }),
    );

    const result = await policyAgent.run(
      makeAgentContext({
        classification: makeClassification({ intent: "refund_request" }),
        accountContext: makeAccountContext({ policies: [REFUND_POLICY] }),
      }),
    );

    if (isPolicyFinding(result.finding)) {
      expect(result.finding.policyDecision?.decision).toBe("approve");
      expect(result.finding.policyReferences).toEqual([{ slug: "refund-policy", title: "Refund Policy" }]);
    }
    expect(result.finding.flags).not.toContain("ungrounded_policy_citation");
  });
});
