import type { AgentKey, AnyAgentFinding, CustomerResponse } from "@/lib/ai/schemas";
import { AGENT_REGISTRY } from "./agents/registry";
import { classifyTicket, type ClassifyResult } from "./classify";
import { resolveOutcome, type ResolveOutcomeResult } from "./resolve";
import { selectAgents } from "./selectAgents";
import type { AgentContext, AgentResult } from "./types";

export interface OrchestrationOutcome {
  classification: ClassifyResult["classification"];
  classificationFailed: boolean;
  classificationMetrics: ClassifyResult["metrics"];
  agentsInvoked: AgentKey[];
  agentResults: AgentResult[];
  resolution: ResolveOutcomeResult["resolution"];
  escalation: ResolveOutcomeResult["escalation"];
  response: CustomerResponse | null;
}

/**
 * The explicit orchestration pipeline described in PRODUCT_SPEC.md:
 *
 *   Ticket → Classification → Agent selection → Specialist execution
 *          → Structured findings → Resolution/escalation → Customer response
 *
 * This is a plain function, not a framework-managed agent graph — see
 * DECISIONS.md ("Why we built our own orchestrator"). It is DB-free and
 * unit-testable on its own (see orchestrator.test.ts); loading real ticket
 * data and persisting the result are separate concerns (context.ts,
 * persist.ts, analyzeTicket.ts).
 *
 * One deliberate deviation from "run every selected agent in AGENT_KEYS
 * order": the Response agent runs LAST, after resolveOutcome(), not as
 * just another selected agent — because its job is to communicate the
 * resolution, not to help produce it. See DECISIONS.md ("Response agent
 * runs after resolution, not as a uniform pipeline step").
 */
export async function runOrchestration(
  context: Pick<AgentContext, "ticketId" | "ticketSummary" | "conversation" | "accountContext">,
): Promise<OrchestrationOutcome> {
  const { classification, failed: classificationFailed, metrics: classificationMetrics } =
    await classifyTicket(context);

  const selectedKeys = selectAgents(classification);
  const investigativeKeys = selectedKeys.filter((key) => key !== "response");
  const runsResponse = selectedKeys.includes("response");

  const agentResults: AgentResult[] = [];
  for (const key of investigativeKeys) {
    const agent = AGENT_REGISTRY[key];
    const result = await agent.run({
      ...context,
      classification,
      priorFindings: agentResults.map((r) => r.finding),
    });
    agentResults.push(result);
  }

  const findings: AnyAgentFinding[] = agentResults.map((r) => r.finding);
  const { resolution, escalation } = resolveOutcome(classification, classificationFailed, findings);

  let response: CustomerResponse | null = null;
  if (runsResponse) {
    const responseAgent = AGENT_REGISTRY.response;
    const result = await responseAgent.run({
      ...context,
      classification,
      priorFindings: findings,
      resolution,
      escalation,
    });
    agentResults.push(result);
    response = result.response ?? null;
  }

  return {
    classification,
    classificationFailed,
    classificationMetrics,
    agentsInvoked: selectedKeys,
    agentResults,
    resolution,
    escalation,
    response,
  };
}
