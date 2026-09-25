import { afterEach, describe, expect, it } from "vitest";
import { billingAgent } from "@/lib/orchestrator/agents/billingAgent";
import { technicalAgent } from "@/lib/orchestrator/agents/technicalAgent";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { AgentFindingSchema } from "@/lib/ai/schemas";
import type { SpecialistAgent } from "@/lib/orchestrator/types";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAgentContext } from "./testSupport/fixtures";

/**
 * Billing and Technical never cite policy: neither is shown any, and both always
 * store `policyReferences: []` (DECISIONS.md, "Billing and Technical do not parse
 * policy citations"). Their parsing contract therefore omits the field, so a
 * citation the model emits anyway, well-formed or malformed, cannot reject an
 * otherwise valid finding or cost a retry. A live run did exactly that: Billing's
 * finding degraded to `agent_failed` because of a malformed citation alone.
 *
 * The tolerance is limited to that one field: a malformed substantive field still
 * fails, retries once and degrades, as before.
 */
const AGENTS: [string, SpecialistAgent, string, string][] = [
  ["billing", billingAgent, "billing_agent_finding", "payment_failed_awaiting_customer_action"],
  ["technical", technicalAgent, "technical_agent_finding", "auto_resolvable"],
];

afterEach(() => {
  _resetProvidersForTests();
});

describe.each(AGENTS)("%s agent: policy citations are not part of its parsing contract", (agentKey, agent, task, flag) => {
  const substantive = {
    agentKey,
    summary: `${agentKey} finding with a valid substantive result`,
    evidence: ["one concrete piece of evidence"],
    confidence: 0.9,
    flags: [flag],
  };

  /** Registers a provider that answers this agent's task and counts the calls made. */
  function answerWith(body: unknown): { calls: () => number } {
    let calls = 0;
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        [task]: () => {
          calls++;
          return typeof body === "string" ? body : JSON.stringify(body);
        },
      }),
    );
    return { calls: () => calls };
  }

  function expectValidFinding(finding: Awaited<ReturnType<SpecialistAgent["run"]>>["finding"]) {
    expect(finding.flags).toEqual([flag]);
    expect(finding.flags).not.toContain("agent_failed");
    expect(finding.confidence).toBe(0.9);
    expect(finding.evidence).toEqual(substantive.evidence);
    expect(finding.policyReferences).toEqual([]);
    // Still the stored/output shape every consumer expects.
    expect(AgentFindingSchema.safeParse(finding).success).toBe(true);
  }

  it("a malformed citation is ignored: the substantive finding survives, with one model call and no retry", async () => {
    const provider = answerWith({ ...substantive, policyReferences: [{ policy: "none" }] });
    const result = await agent.run(makeAgentContext());
    expectValidFinding(result.finding);
    expect(provider.calls()).toBe(1);
  });

  it("a citation of the wrong type altogether is ignored the same way", async () => {
    const provider = answerWith({ ...substantive, policyReferences: "refund-policy" });
    const result = await agent.run(makeAgentContext());
    expectValidFinding(result.finding);
    expect(provider.calls()).toBe(1);
  });

  it("a well-formed citation is still discarded: the agent stores no citations", async () => {
    const provider = answerWith({ ...substantive, policyReferences: [{ slug: "refund-policy", title: "Refund Policy" }] });
    const result = await agent.run(makeAgentContext());
    expectValidFinding(result.finding);
    expect(provider.calls()).toBe(1);
  });

  it("an omitted citation field is a valid finding with no citations", async () => {
    const provider = answerWith(substantive);
    const result = await agent.run(makeAgentContext());
    expectValidFinding(result.finding);
    expect(provider.calls()).toBe(1);
  });

  it("a malformed substantive field still fails, retries once and degrades: the tolerance covers citations only", async () => {
    const provider = answerWith({ ...substantive, confidence: 7, policyReferences: [{ policy: "none" }] });
    const result = await agent.run(makeAgentContext());
    expect(result.finding.flags).toEqual(["agent_failed"]);
    expect(result.finding.confidence).toBe(0);
    expect(result.finding.policyReferences).toEqual([]);
    expect(provider.calls()).toBe(2);
  });
});
