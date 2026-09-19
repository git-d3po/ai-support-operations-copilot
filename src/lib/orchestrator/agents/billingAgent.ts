import { AgentFindingSchema, KNOWN_AGENT_FLAGS } from "@/lib/ai/schemas";
import { detectDuplicateCharges, filterGroundedPolicyReferences, mostRecentFailedCharge } from "../evidence";
import {
  formatInvoices,
  formatTransactions,
  formatConversation,
  buildSystemPrompt,
  JSON_ONLY_INSTRUCTION,
} from "../prompts";
import { runStructuredStep } from "../runStructuredStep";
import type { AgentContext, AgentResult, SpecialistAgent } from "../types";
import { degradedAgentFinding } from "./fallback";

function buildRequest(context: AgentContext, retryContext?: string) {
  const { accountContext } = context;
  const duplicates = detectDuplicateCharges(accountContext.transactions);
  const failedCharge = mostRecentFailedCharge(accountContext.transactions);

  const system = buildSystemPrompt(
    "billing_agent_finding",
    `You are the Billing Agent for Halcyon, a B2B SaaS company. You investigate ONLY billing facts: duplicate charges, failed payments, and refund-relevant billing history. You do not decide policy questions (a separate Policy Agent does that) — you surface facts and cite specific evidence (dates, amounts, transaction/invoice identifiers) from the records provided.

Available flags (use only these, choose all that apply):
- "${KNOWN_AGENT_FLAGS.DUPLICATE_CHARGE_CONFIRMED}" — a duplicate charge is confirmed in the pre-computed analysis below.
- "${KNOWN_AGENT_FLAGS.PAYMENT_FAILED_AWAITING_CUSTOMER_ACTION}" — a payment recently failed and the customer needs to act (update payment method) or the system will auto-retry.
- "${KNOWN_AGENT_FLAGS.NO_BILLING_ISSUE_FOUND}" — nothing billing-related needs action.

Respond with JSON matching: {"agentKey":"billing","summary":string,"evidence":string[],"confidence":number 0-1,"policyReferences":[],"flags":string[]}. ${JSON_ONLY_INSTRUCTION}`,
  );

  const duplicateSummary =
    duplicates.length > 0
      ? duplicates
          .map((d) => `CONFIRMED DUPLICATE: two ${d.a.type} transactions of the same amount on the same invoice, ${d.hoursApart}h apart.`)
          .join("\n")
      : "No duplicate charges detected by automated analysis.";

  const failedChargeSummary = failedCharge
    ? `Most recent failed charge: ${failedCharge.type} on ${failedCharge.occurredAt.toISOString().slice(0, 10)}, reason: ${failedCharge.reason ?? "unknown"}.`
    : "No recent failed charges.";

  const user = `Ticket: ${context.ticketSummary}

Conversation:
${formatConversation(context.conversation)}

Invoices:
${formatInvoices(accountContext.invoices)}

Transactions:
${formatTransactions(accountContext.transactions)}

Automated duplicate-charge analysis:
${duplicateSummary}

${failedChargeSummary}
${retryContext ? `\n${retryContext}` : ""}`;

  return { system, messages: [{ role: "user" as const, content: user }] };
}

export const billingAgent: SpecialistAgent = {
  key: "billing",
  description:
    "Reviews invoices, transactions, and subscription history for billing-related tickets.",
  async run(context): Promise<AgentResult> {
    const { data, parseError, metrics } = await runStructuredStep(
      "billing",
      AgentFindingSchema,
      (retryContext) => buildRequest(context, retryContext),
    );
    // Billing is never shown any policy documents (see buildRequest above),
    // so it has nothing legitimate to cite — strip any citation anyway in
    // case the model invents one. Same enforcement as Policy/Risk agents;
    // see DECISIONS.md ("Enforcing, not just prompting for, grounded
    // policy citations").
    const finding = data ? { ...data, policyReferences: filterGroundedPolicyReferences(data.policyReferences, []) } : degradedAgentFinding("billing", parseError!);
    return {
      finding,
      metrics,
    };
  },
};
