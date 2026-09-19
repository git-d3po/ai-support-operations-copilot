import type {
  AgentFinding,
  AgentKey,
  TicketClassification,
} from "@/lib/ai/schemas";
import type { ProviderKey } from "@/lib/ai/providers/registry";

/**
 * Everything a specialist agent needs to do its job. Deliberately a plain
 * data bag (ticket + related records already loaded) rather than giving
 * agents direct database access — keeps agents pure functions of their
 * input, which is what makes them unit-testable and evaluable.
 */
export interface AgentContext {
  ticketId: string;
  classification: TicketClassification;
  ticketSummary: string;
  conversation: { author: string; body: string }[];
  /** Pre-fetched, agent-relevant account/billing/policy data. Shape is
   * intentionally loose here (`unknown`) because each agent only needs a
   * slice of it; agents narrow/validate what they read. */
  accountContext: unknown;
}

export interface AgentRunMetrics {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  estimatedCostUsd?: number;
}

export interface AgentResult {
  finding: AgentFinding;
  metrics: AgentRunMetrics;
}

/**
 * Every step in the pipeline that calls a model, for routing/cost-tracking
 * purposes: the 5 specialist agents, plus classification (which isn't a
 * specialist agent — it runs before agent selection even happens, but
 * still needs its own routed model). See modelRouting.ts and
 * modelClient.ts.
 */
export type PipelineStepKey = AgentKey | "classifier";

/**
 * The contract every specialist agent implements. `key` must match one of
 * AGENT_KEYS and is how the orchestrator's dynamic selection logic refers
 * to the agent — see selectAgents.ts.
 */
export interface SpecialistAgent {
  key: AgentKey;
  /** Short description shown in the UI's "why this agent ran" explanation. */
  description: string;
  run(context: AgentContext): Promise<AgentResult>;
}

/** Per-agent model routing: which provider + model an agent uses, kept
 * separate from agent logic so either can change — including switching
 * provider entirely — without touching agent implementations or the
 * orchestrator. See src/lib/ai/providers/ and DECISIONS.md ("Model
 * provider abstraction"). */
export interface ModelRoutingConfig {
  [agentKey: string]: {
    provider: ProviderKey;
    model: string;
    /** USD per 1M input/output tokens, for cost estimation in the UI. */
    inputCostPerMTokUsd: number;
    outputCostPerMTokUsd: number;
  };
}
