import type { TicketDataContext } from "@/lib/orchestrator/context";
import type { AgentContext } from "@/lib/orchestrator/types";
import type { TicketClassification } from "@/lib/ai/schemas";

/** A fixed, explicit request time so tests never depend on the wall clock.
 * Tests that care about the value pass their own `requestedAt`. */
export const DEFAULT_REQUESTED_AT = new Date("2026-09-18T12:00:00.000Z");

export function makeAccountContext(overrides: Partial<TicketDataContext> = {}): TicketDataContext {
  return {
    requestedAt: DEFAULT_REQUESTED_AT,
    customer: { name: "Jordan Blake", email: "jordan@example.com", company: "Example Co" },
    account: { plan: "growth", status: "active", mrrCents: 29700, riskScore: 15 },
    subscriptions: [],
    invoices: [],
    transactions: [],
    policies: [],
    productDocs: [],
    ...overrides,
  };
}

export function makeClassification(overrides: Partial<TicketClassification> = {}): TicketClassification {
  return {
    intent: "general_inquiry",
    domains: [],
    sentiment: "neutral",
    confidence: 0.8,
    summary: "test classification",
    keyEvidence: [],
    ...overrides,
  };
}

export function makeAgentContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    ticketId: "test-ticket",
    classification: makeClassification(),
    ticketSummary: "Test ticket",
    conversation: [{ author: "customer", body: "This is a test message." }],
    accountContext: makeAccountContext(),
    priorFindings: [],
    ...overrides,
  };
}
