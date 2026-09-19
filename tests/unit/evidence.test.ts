import { describe, expect, it } from "vitest";
import {
  chargebackCount,
  daysSince,
  detectDuplicateCharges,
  mostRecentFailedCharge,
  mostRecentInvoice,
  mostRecentSucceededCharge,
  retrieveRelevantPolicies,
  retrieveRelevantProductDocs,
} from "@/lib/orchestrator/evidence";
import type { TicketClassification } from "@/lib/ai/schemas";

function tx(overrides: Partial<Parameters<typeof detectDuplicateCharges>[0][number]>) {
  return {
    type: "charge",
    status: "succeeded",
    amountCents: 1000,
    reason: null,
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    invoiceNumber: "INV-1",
    ...overrides,
  };
}

describe("detectDuplicateCharges", () => {
  it("flags two identical, same-invoice charges within 48 hours", () => {
    const pairs = detectDuplicateCharges([
      tx({ occurredAt: new Date("2026-01-01T00:00:00Z") }),
      tx({ occurredAt: new Date("2026-01-01T10:00:00Z") }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].hoursApart).toBe(10);
  });

  it("does not flag charges more than 48 hours apart", () => {
    const pairs = detectDuplicateCharges([
      tx({ occurredAt: new Date("2026-01-01T00:00:00Z") }),
      tx({ occurredAt: new Date("2026-01-05T00:00:00Z") }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("does not flag charges with different amounts", () => {
    const pairs = detectDuplicateCharges([
      tx({ amountCents: 1000, occurredAt: new Date("2026-01-01T00:00:00Z") }),
      tx({ amountCents: 2000, occurredAt: new Date("2026-01-01T01:00:00Z") }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("does not flag charges on different invoices", () => {
    const pairs = detectDuplicateCharges([
      tx({ invoiceNumber: "INV-1", occurredAt: new Date("2026-01-01T00:00:00Z") }),
      tx({ invoiceNumber: "INV-2", occurredAt: new Date("2026-01-01T01:00:00Z") }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("ignores failed charges and refunds", () => {
    const pairs = detectDuplicateCharges([
      tx({ status: "failed", occurredAt: new Date("2026-01-01T00:00:00Z") }),
      tx({ type: "refund", occurredAt: new Date("2026-01-01T01:00:00Z") }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("does not pair a charge with itself and does not double-count a pair", () => {
    const pairs = detectDuplicateCharges([
      tx({ occurredAt: new Date("2026-01-01T00:00:00Z") }),
      tx({ occurredAt: new Date("2026-01-01T01:00:00Z") }),
      tx({ occurredAt: new Date("2026-01-01T02:00:00Z") }),
    ]);
    // 3 mutually-duplicate charges -> 3 pairs (1-2, 1-3, 2-3), not 6.
    expect(pairs).toHaveLength(3);
  });
});

describe("daysSince", () => {
  it("computes whole days between two dates", () => {
    expect(daysSince(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-15T00:00:00Z"))).toBe(14);
  });

  it("returns 0 for the same day", () => {
    expect(daysSince(new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"))).toBe(0);
  });
});

describe("mostRecentSucceededCharge / mostRecentFailedCharge / mostRecentInvoice", () => {
  const transactions = [
    tx({ occurredAt: new Date("2026-01-01T00:00:00Z") }),
    tx({ status: "failed", occurredAt: new Date("2026-01-10T00:00:00Z") }),
    tx({ occurredAt: new Date("2026-01-05T00:00:00Z") }),
  ];

  it("finds the most recent succeeded charge, ignoring failed ones", () => {
    const result = mostRecentSucceededCharge(transactions);
    expect(result?.occurredAt).toEqual(new Date("2026-01-05T00:00:00Z"));
  });

  it("finds the most recent failed charge", () => {
    const result = mostRecentFailedCharge(transactions);
    expect(result?.occurredAt).toEqual(new Date("2026-01-10T00:00:00Z"));
  });

  it("returns null when there are none", () => {
    expect(mostRecentFailedCharge([tx({ status: "succeeded" })])).toBeNull();
  });

  it("finds the most recent invoice", () => {
    const result = mostRecentInvoice([
      { number: "A", status: "paid", amountCents: 100, issuedAt: new Date("2026-01-01"), dueAt: new Date(), paidAt: null },
      { number: "B", status: "paid", amountCents: 100, issuedAt: new Date("2026-02-01"), dueAt: new Date(), paidAt: null },
    ]);
    expect(result?.number).toBe("B");
  });
});

describe("chargebackCount", () => {
  it("counts only chargeback-type transactions", () => {
    expect(chargebackCount([tx({ type: "chargeback" }), tx({ type: "charge" }), tx({ type: "chargeback" })])).toBe(2);
  });
});

function classification(overrides: Partial<TicketClassification>): TicketClassification {
  return {
    intent: "general_inquiry",
    domains: [],
    sentiment: "neutral",
    confidence: 0.8,
    summary: "test",
    keyEvidence: [],
    ...overrides,
  };
}

describe("retrieveRelevantPolicies", () => {
  const policies = [
    { slug: "refund-policy", title: "Refund Policy", category: "refunds", body: "" },
    { slug: "sla-support-policy", title: "SLA", category: "technical", body: "" },
    { slug: "escalation-policy", title: "Escalation", category: "escalation", body: "" },
  ];

  it("returns only categories relevant to the intent", () => {
    const result = retrieveRelevantPolicies(policies, classification({ intent: "refund_request" }));
    expect(result.map((p) => p.slug)).toEqual(["refund-policy"]);
  });

  it("returns nothing for intents with no relevant policy category", () => {
    const result = retrieveRelevantPolicies(policies, classification({ intent: "feature_question" }));
    expect(result).toEqual([]);
  });

  it("always includes explicitly requested slugs regardless of category", () => {
    const result = retrieveRelevantPolicies(policies, classification({ intent: "feature_question" }), {
      alwaysInclude: ["escalation-policy"],
    });
    expect(result.map((p) => p.slug)).toEqual(["escalation-policy"]);
  });
});

describe("retrieveRelevantProductDocs", () => {
  const docs = [
    {
      slug: "known-issue-automation-timeout",
      title: "Known Issue: Automations Time Out on Large Boards",
      product: "core",
      body: "Automations attached to boards with more than 2,000 cards can stop firing after a plan change.",
    },
    {
      slug: "sso-saml-setup-guide",
      title: "Setting Up SSO / SAML",
      product: "SSO-ADDON",
      body: "SSO is available on the SSO add-on. Upload identity provider metadata XML.",
    },
  ];

  it("ranks the doc with the most keyword overlap first", () => {
    const result = retrieveRelevantProductDocs(
      docs,
      "Our automations stopped firing after we upgraded, our board has thousands of cards",
    );
    expect(result[0]?.slug).toBe("known-issue-automation-timeout");
  });

  it("returns an empty array when nothing overlaps", () => {
    const result = retrieveRelevantProductDocs(docs, "unrelated question about pricing tiers");
    expect(result).toEqual([]);
  });
});
