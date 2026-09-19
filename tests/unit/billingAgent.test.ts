import { afterEach, describe, expect, it } from "vitest";
import { billingAgent } from "@/lib/orchestrator/agents/billingAgent";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAccountContext, makeAgentContext } from "./testSupport/fixtures";

afterEach(() => {
  _resetProvidersForTests();
});

describe("billingAgent", () => {
  it("returns the model's structured finding on success", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        billing_agent_finding: JSON.stringify({
          agentKey: "billing",
          summary: "Confirmed duplicate charge of $399.00.",
          evidence: ["Two $399.00 charges on 2026-01-01, 10h apart, same invoice"],
          confidence: 0.95,
          policyReferences: [],
          flags: ["duplicate_charge_confirmed"],
        }),
      }),
    );

    const context = makeAgentContext({
      accountContext: makeAccountContext({
        transactions: [
          {
            type: "charge",
            status: "succeeded",
            amountCents: 39900,
            reason: null,
            occurredAt: new Date("2026-01-01T00:00:00Z"),
            invoiceNumber: "INV-1",
          },
          {
            type: "charge",
            status: "succeeded",
            amountCents: 39900,
            reason: null,
            occurredAt: new Date("2026-01-01T10:00:00Z"),
            invoiceNumber: "INV-1",
          },
        ],
      }),
    });

    const result = await billingAgent.run(context);

    expect(result.finding.agentKey).toBe("billing");
    expect(result.finding.flags).toContain("duplicate_charge_confirmed");
    expect(result.finding.confidence).toBe(0.95);
    expect(result.metrics.model).toBeTruthy();
  });

  it("falls back to a degraded, honest finding when the model output never parses", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({ billing_agent_finding: "not json at all" }),
    );

    const result = await billingAgent.run(makeAgentContext());

    expect(result.finding.agentKey).toBe("billing");
    expect(result.finding.confidence).toBe(0);
    expect(result.finding.flags).toContain("agent_failed");
  });

  it("never crashes the pipeline when the response is missing required fields", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        billing_agent_finding: JSON.stringify({ agentKey: "billing" }), // missing summary/evidence/confidence
      }),
    );

    const result = await billingAgent.run(makeAgentContext());
    expect(result.finding.flags).toContain("agent_failed");
  });
});
