import type { TicketDataContext } from "./context";
import { formatCents, formatDate } from "./evidence";

/**
 * Every pipeline step's system prompt starts with a stable `TASK: <name>`
 * line. This isn't decoration — it's what lets the same request shape be
 * unambiguously identified downstream: the e2e test fixture provider
 * (src/lib/ai/providers/e2eMockProvider.ts) and unit test mocks dispatch
 * canned responses by reading this line, and it makes real prompts
 * self-documenting when inspected in logs.
 */
export function buildSystemPrompt(task: string, instructions: string): string {
  return `TASK: ${task}\n\n${instructions}`;
}

export function formatConversation(conversation: { author: string; body: string }[]): string {
  if (conversation.length === 0) return "(no messages)";
  return conversation.map((m) => `[${m.author}] ${m.body}`).join("\n\n");
}

export function formatInvoices(invoices: TicketDataContext["invoices"]): string {
  if (invoices.length === 0) return "(no invoices on file)";
  return invoices
    .map(
      (inv) =>
        `- ${inv.number}: ${inv.status}, ${formatCents(inv.amountCents)}, issued ${formatDate(inv.issuedAt)}` +
        (inv.paidAt ? `, paid ${formatDate(inv.paidAt)}` : ", unpaid"),
    )
    .join("\n");
}

export function formatTransactions(transactions: TicketDataContext["transactions"]): string {
  if (transactions.length === 0) return "(no transactions on file)";
  return transactions
    .map(
      (tx) =>
        `- ${formatDate(tx.occurredAt)}: ${tx.type} ${tx.status}, ${formatCents(tx.amountCents)}` +
        (tx.invoiceNumber ? ` (invoice ${tx.invoiceNumber})` : "") +
        (tx.reason ? `, reason: ${tx.reason}` : ""),
    )
    .join("\n");
}

export function formatAccountSummary(context: TicketDataContext): string {
  if (!context.account) return "(no account on file)";
  return [
    `Customer: ${context.customer.name} (${context.customer.company})`,
    `Plan: ${context.account.plan}, status: ${context.account.status}`,
    `MRR: ${formatCents(context.account.mrrCents)}, risk score: ${context.account.riskScore}/100`,
  ].join("\n");
}

export function formatPolicies(policies: TicketDataContext["policies"]): string {
  if (policies.length === 0) return "(no policies matched this ticket's category)";
  return policies.map((p) => `### ${p.title} (slug: ${p.slug})\n${p.body}`).join("\n\n");
}

export function formatProductDocs(docs: TicketDataContext["productDocs"]): string {
  if (docs.length === 0) return "(no product documentation matched this ticket)";
  return docs.map((d) => `### ${d.title} (slug: ${d.slug})\n${d.body}`).join("\n\n");
}

/** Every structured-output prompt ends with the same instruction to avoid
 * repeating this boilerplate five times with slightly different wording. */
export const JSON_ONLY_INSTRUCTION =
  "Return ONLY a single JSON object matching the schema described above. No prose, no markdown code fences, no explanation before or after the JSON.";
