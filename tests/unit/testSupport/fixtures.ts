import type { TicketDataContext } from "@/lib/orchestrator/context";
import type { AgentContext } from "@/lib/orchestrator/types";
import type { TicketClassification } from "@/lib/ai/schemas";

export function makeAccountContext(overrides: Partial<TicketDataContext> = {}): TicketDataContext {
  return {
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
