import type { TicketClassification } from "@/lib/ai/schemas";
import type { AgentContext } from "./types";

/**
 * Phase 2 replaces this with a real call through
 * `callModel("classifier", {...})` (src/lib/orchestrator/modelClient.ts)
 * that reads the ticket + conversation and returns a validated
 * TicketClassification (see parseStructuredOutput). For the foundation
 * phase this returns a deterministic placeholder so the rest of the
 * pipeline (selection → agents → aggregation) is exercisable and testable
 * without an API key.
 */
export async function classifyTicket(
  context: Pick<AgentContext, "ticketSummary" | "conversation">,
): Promise<TicketClassification> {
  void context;
  return {
    intent: "general_inquiry",
    domains: ["technical"],
    sentiment: "neutral",
    confidence: 0,
    summary: "Classification not yet implemented (foundation phase).",
    keyEvidence: [],
  };
}
