import { AGENT_KEYS, type AgentKey, type TicketClassification } from "@/lib/ai/schemas";

/**
 * Decide which specialist agents should run for a ticket. This is the
 * "dynamic agent selection" the product spec calls for: we start from what
 * the classifier says the ticket touches, then apply a small set of
 * explicit business-rule overrides that a classifier alone shouldn't be
 * trusted to get right on its own (e.g. always loop in Risk for security
 * complaints, even if the classifier under-called it).
 *
 * This function is pure and synchronous on purpose — agent selection is a
 * routing decision, not something that itself needs a model call, and
 * keeping it deterministic makes it directly unit-testable and evaluable
 * (see EVALUATION.md, "routing accuracy").
 *
 * Explicitly NOT done here: invoking every agent for every ticket. A ticket
 * about a password reset should never trigger the Billing or Risk agent.
 */
export function selectAgents(
  classification: TicketClassification,
): AgentKey[] {
  const selected = new Set<AgentKey>(classification.domains);

  // Business-rule overrides: cases where under-selecting is costly enough
  // that we don't rely on the classifier alone.
  if (classification.intent === "account_security") {
    selected.add("risk");
  }
  if (classification.intent === "cancellation") {
    selected.add("risk");
    selected.add("policy");
  }
  if (classification.intent === "refund_request") {
    selected.add("policy");
  }
  // A duplicate charge leads to a refund, which only a Policy decision may
  // authorize (resolveOutcome() refunds solely on Policy "approve"). A live
  // classifier returned domains ["billing"] for this intent, so Policy never
  // ran and no refund could be authorized — hence deterministic, not left to
  // the classifier. Billing is added too: it supplies the duplicate-charge
  // evidence the Policy decision rests on. See DECISIONS.md ("Deterministic
  // routing for consequential policy decisions...").
  if (classification.intent === "duplicate_charge") {
    selected.add("billing");
    selected.add("policy");
  }
  if (classification.sentiment === "angry" || classification.sentiment === "urgent") {
    selected.add("risk");
  }

  // The Response agent drafts the customer-facing reply from whatever the
  // other selected agents found. Every ticket that reaches a decision needs
  // a proposed response for the operator to review, so it always runs last.
  selected.add("response");

  // Stable order (matches AGENT_KEYS) so the UI timeline is deterministic.
  return AGENT_KEYS.filter((key) => selected.has(key));
}
