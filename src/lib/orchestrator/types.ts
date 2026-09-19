import type {
  AgentKey,
  AnyAgentFinding,
  CustomerResponse,
  EscalationDecision,
  ResolutionDecision,
  TicketClassification,
} from "@/lib/ai/schemas";
import type { ProviderKey } from "@/lib/ai/providers/registry";
import type { TicketDataContext } from "./context";

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
  /** Pre-fetched account/billing/knowledge data. Agents read only the
   * slice they need when building their prompt (see prompts.ts). */
  accountContext: TicketDataContext;
  /** Findings from agents that already ran earlier in this pipeline
   * (billing/policy/technical run before risk; all four run before
   * response). Lets Risk weigh other agents' evidence, and lets Response
   * summarize them — without either agent re-deriving them itself. */
  priorFindings: AnyAgentFinding[];
  /** Populated only for the Response agent, which runs *after*
   * resolveOutcome() — see orchestrator.ts and DECISIONS.md ("Response
   * agent runs after resolution, not as a uniform pipeline step"). Absent
   * for every other agent. */
  resolution?: ResolutionDecision;
  escalation?: EscalationDecision | null;
}

export interface AgentRunMetrics {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  estimatedCostUsd?: number;
}

export interface AgentResult {
  finding: AnyAgentFinding;
  metrics: AgentRunMetrics;
  /** Only populated by the Response agent — the actual drafted reply.
   * Every other agent leaves this undefined. */
  response?: CustomerResponse;
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
