import type { AgentKey } from "@/lib/ai/schemas";
import type { AgentContext, AgentResult } from "../types";

/**
 * Placeholder agent behavior for the foundation phase. Each specialist
 * agent module wires this into the real `SpecialistAgent` contract so the
 * orchestrator's control flow (select → invoke → aggregate) is real and
 * testable end-to-end before any agent has real model-backed reasoning.
 *
 * Phase 2 replaces the body of each agent's `run()` with a real call
 * through `callModel(agentKey, {...})` (src/lib/orchestrator/modelClient.ts)
 * — never a provider SDK directly — plus real evidence drawn from
 * `context.accountContext`. Nothing about the orchestrator, schemas, model
 * routing, or UI needs to change when that happens: that's the point of
 * both the SpecialistAgent interface and the model provider abstraction
 * (see DECISIONS.md, "Model provider abstraction").
 */
export function stubAgentResult(
  agentKey: AgentKey,
  context: AgentContext,
  model: string,
): AgentResult {
  return {
    finding: {
      agentKey,
      summary: `${agentKey} agent not yet implemented (foundation phase). Ticket intent: ${context.classification.intent}.`,
      evidence: [],
      confidence: 0,
      policyReferences: [],
      flags: ["stub_not_implemented"],
    },
    metrics: {
      model,
      latencyMs: 0,
    },
  };
}
