import type { AgentKey, TicketClassification, TicketIntent } from "@/lib/ai/schemas";
import type { TicketDataContext } from "./context";

/**
 * Deterministic, pure evidence-preparation helpers. These exist because
 * precise arithmetic (date math, matching two transactions) is exactly the
 * kind of thing a model is unreliable at and code is exact at — so we
 * compute it in code and hand the *result* to the model as evidence,
 * rather than asking the model to compute it itself. See DECISIONS.md
 * ("Deterministic evidence pre-computation for mechanically-checkable
 * facts"). Judgment calls (is this refund story credible, does this
 * warrant escalation) are left to the model, which does see the
 * underlying records too.
 */

type Transaction = TicketDataContext["transactions"][number];
type Invoice = TicketDataContext["invoices"][number];

export interface DuplicateChargePair {
  a: Transaction;
  b: Transaction;
  hoursApart: number;
}

/** Per the synthetic Duplicate Charge Policy: two "charge"/"succeeded"
 * transactions, same amount, on the same invoice (or both unlinked),
 * within 48 hours of each other. */
export function detectDuplicateCharges(transactions: Transaction[]): DuplicateChargePair[] {
  const charges = transactions.filter((t) => t.type === "charge" && t.status === "succeeded");
  const pairs: DuplicateChargePair[] = [];

  for (let i = 0; i < charges.length; i++) {
    for (let j = i + 1; j < charges.length; j++) {
      const a = charges[i];
      const b = charges[j];
      if (a.amountCents !== b.amountCents) continue;
      if (a.invoiceNumber !== b.invoiceNumber) continue;
      const hoursApart = Math.abs(a.occurredAt.getTime() - b.occurredAt.getTime()) / (1000 * 60 * 60);
      if (hoursApart <= 48) {
        pairs.push({ a, b, hoursApart: Math.round(hoursApart * 10) / 10 });
      }
    }
  }
  return pairs;
}

export function daysSince(date: Date, now: Date): number {
  return Math.round((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
}

/** With `asOf` (the customer's request time), only charges at or before that
 * instant count: a charge made after a request cannot be what the request is
 * about. Without it, behavior is unchanged. */
export function mostRecentSucceededCharge(transactions: Transaction[], asOf?: Date): Transaction | null {
  const charges = transactions.filter(
    (t) => t.type === "charge" && t.status === "succeeded" && (!asOf || t.occurredAt <= asOf),
  );
  if (charges.length === 0) return null;
  return charges.reduce((latest, tx) => (tx.occurredAt > latest.occurredAt ? tx : latest));
}

export function mostRecentFailedCharge(transactions: Transaction[]): Transaction | null {
  const failed = transactions.filter((t) => t.type === "charge" && t.status === "failed");
  if (failed.length === 0) return null;
  return failed.reduce((latest, tx) => (tx.occurredAt > latest.occurredAt ? tx : latest));
}

export function chargebackCount(transactions: Transaction[]): number {
  return transactions.filter((t) => t.type === "chargeback").length;
}

export function mostRecentInvoice(invoices: Invoice[]): Invoice | null {
  if (invoices.length === 0) return null;
  return invoices.reduce((latest, inv) => (inv.issuedAt > latest.issuedAt ? inv : latest));
}

// ---------------------------------------------------------------------------
// Knowledge retrieval — simple, inspectable, deterministic. Not semantic
// search or embeddings: the knowledge base is a handful of documents, and
// keyword overlap is enough to be genuinely useful without adding a vector
// store for a dataset this size. See DECISIONS.md.
// ---------------------------------------------------------------------------

/** Which policy categories are plausibly relevant to a given intent. A
 * deterministic routing table, not a guess per ticket — the model still
 * decides which (if any) of the retrieved policies actually applies and
 * whether its conditions are met. */
const POLICY_CATEGORIES_BY_INTENT: Record<TicketIntent, string[]> = {
  refund_request: ["refunds", "billing"],
  duplicate_charge: ["billing"],
  cancellation: ["billing", "escalation"],
  account_security: ["security", "escalation"],
  technical_issue: ["technical", "escalation"],
  failed_payment: ["billing"],
  billing_question: ["billing", "refunds"],
  password_reset: ["security"],
  feature_question: [],
  general_inquiry: [],
};

export function retrieveRelevantPolicies(
  policies: TicketDataContext["policies"],
  classification: TicketClassification,
  opts: { alwaysInclude?: string[] } = {},
): TicketDataContext["policies"] {
  const categories = POLICY_CATEGORIES_BY_INTENT[classification.intent] ?? [];
  const always = new Set(opts.alwaysInclude ?? []);
  return policies.filter((p) => categories.includes(p.category) || always.has(p.slug));
}

/**
 * A model can cite a policy slug/title that was never actually shown to
 * it — the schema only checks shape (two strings), not that the citation
 * is real. This is the enforcement layer: a citation only counts as
 * grounded if its slug is among the policies actually retrieved and put
 * in that call's prompt. Used to filter `AgentFinding.policyReferences`
 * and to validate `PolicyDecision.applicablePolicy` before either is
 * allowed to drive resolution or render as if verified. See DECISIONS.md
 * ("Enforcing, not just prompting for, grounded policy citations").
 */
export function filterGroundedPolicyReferences<T extends { slug: string }>(
  references: T[],
  retrievedPolicies: TicketDataContext["policies"],
): T[] {
  const validSlugs = new Set(retrievedPolicies.map((p) => p.slug));
  return references.filter((ref) => validSlugs.has(ref.slug));
}

export function isPolicyGrounded(slug: string, retrievedPolicies: TicketDataContext["policies"]): boolean {
  return retrievedPolicies.some((p) => p.slug === slug);
}

const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "have", "from", "your", "you",
  "are", "was", "were", "been", "being", "has", "had", "our", "their", "them",
  "will", "can", "could", "would", "should", "not", "but", "all", "any",
]);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

/** Keyword-overlap scoring between the ticket text and each doc's
 * title+body. Returns docs with score > 0, highest first, capped at 3. */
export function retrieveRelevantProductDocs(
  productDocs: TicketDataContext["productDocs"],
  ticketText: string,
  limit = 3,
): TicketDataContext["productDocs"] {
  const ticketWords = new Set(significantWords(ticketText));
  if (ticketWords.size === 0) return [];

  const scored = productDocs.map((doc) => {
    const docWords = significantWords(`${doc.title} ${doc.body}`);
    const score = docWords.filter((w) => ticketWords.has(w)).length;
    return { doc, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.doc);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Which pipeline steps ran before this one, in order — used to build the
 * "prior findings" section of a prompt without repeating orchestrator
 * plumbing in every agent file. */
export function summarizePriorFindings(
  findings: { agentKey: AgentKey; summary: string; flags: string[] }[],
): string {
  if (findings.length === 0) return "(none)";
  return findings
    .map((f) => `- [${f.agentKey}] ${f.summary}${f.flags.length ? ` (flags: ${f.flags.join(", ")})` : ""}`)
    .join("\n");
}
