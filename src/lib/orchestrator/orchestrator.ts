import type { CustomerResponse } from "@/lib/ai/schemas";
import { AGENT_REGISTRY } from "./agents/registry";
import { classifyTicket } from "./classify";
import { resolveOutcome } from "./resolve";
import { selectAgents } from "./selectAgents";
import type { AgentContext, AgentResult } from "./types";

export interface OrchestrationOutcome {
  classification: Awaited<ReturnType<typeof classifyTicket>>;
  agentsInvoked: string[];
  agentResults: AgentResult[];
  resolution: ReturnType<typeof resolveOutcome>["resolution"];
  escalation: ReturnType<typeof resolveOutcome>["escalation"];
  response: CustomerResponse | null;
}

/**
 * The explicit orchestration pipeline described in PRODUCT_SPEC.md:
 *
 *   Ticket → Classification → Agent selection → Specialist execution
 *          → Structured findings → Resolution/escalation → Customer response
 *
 * This is a plain function, not a framework-managed agent graph — see
 * DECISIONS.md ("Why we built our own orchestrator"). Persisting the result
 * as an OrchestrationRun (with per-agent AgentInvocation rows) is the
 * caller's responsibility, once the "Run AI analysis" API route exists.
 *
 * Every agent in AGENT_REGISTRY is currently a stub (see agents/stub.ts) —
 * this function's control flow is real and tested; the reasoning behind
 * each step lands in Phase 2.
 */
export async function runOrchestration(
  context: Pick<AgentContext, "ticketId" | "ticketSummary" | "conversation" | "accountContext">,
): Promise<OrchestrationOutcome> {
  const classification = await classifyTicket(context);
  const agentKeys = selectAgents(classification);

  const agentResults: AgentResult[] = [];
  for (const key of agentKeys) {
    const agent = AGENT_REGISTRY[key];
    const result = await agent.run({ ...context, classification });
    agentResults.push(result);
  }

  const findings = agentResults
    .map((r) => r.finding)
    .filter((f) => f.agentKey !== "response");
  const { resolution, escalation } = resolveOutcome(findings);

  return {
    classification,
    agentsInvoked: agentKeys,
    agentResults,
    resolution,
    escalation,
    // Phase 2: the response agent will return a real CustomerResponse
    // instead of a stub AgentFinding once it's implemented.
    response: null,
  };
}
