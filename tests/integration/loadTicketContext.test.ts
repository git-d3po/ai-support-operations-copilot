import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadTicketContext } from "@/lib/orchestrator/context";
import { policyAgent } from "@/lib/orchestrator/agents/policyAgent";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { MockProvider } from "@/lib/ai/providers/mock";
import { makeClassification } from "../unit/testSupport/fixtures";

/**
 * The persisted-data half of the reference-time architecture (DECISIONS.md,
 * "Reference time: business-derived time facts come from persisted event
 * data"): `loadTicketContext` must hand agents the ticket's own `createdAt` as
 * `requestedAt`, and the real Policy prompt built from a REAL loaded context
 * must depend only on stored dates. The ticket here is dated in 2019 — long
 * before any run of this test — so a wall-clock dependence cannot hide.
 *
 * Every row is throwaway (unique email, cleaned up afterward), like
 * persist.test.ts, so the seeded dataset is untouched. No model is called: the
 * provider is a local fixture that only records the prompt.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIME = new Date("2019-03-20T12:00:00.000Z");

let customerIds: string[] = [];

afterEach(async () => {
  _resetProvidersForTests();
  const customers = await db.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, account: { select: { id: true } } } });
  const accountIds = customers.flatMap((c) => (c.account ? [c.account.id] : []));
  const tickets = await db.ticket.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } });
  const ticketIds = tickets.map((t) => t.id);
  await db.message.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await db.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  await db.transaction.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.invoice.deleteMany({ where: { accountId: { in: accountIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
  await db.customer.deleteMany({ where: { id: { in: customerIds } } });
  customerIds = [];
});

async function createHistoricTicket(chargeDaysBeforeRequest: number[]) {
  const customer = await db.customer.create({
    data: {
      name: "Reference Time Test Customer",
      email: `reftime-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      company: "Test Co",
      timezone: "UTC",
      locale: "en-US",
      account: { create: { plan: "growth", status: "active", mrrCents: 29700, riskScore: 10 } },
    },
    include: { account: true },
  });
  customerIds.push(customer.id);

  for (const days of chargeDaysBeforeRequest) {
    await db.transaction.create({
      data: {
        accountId: customer.account!.id,
        type: "charge",
        status: "succeeded",
        amountCents: 29700,
        occurredAt: new Date(REQUEST_TIME.getTime() - days * DAY_MS),
      },
    });
  }

  const ticket = await db.ticket.create({
    data: {
      customerId: customer.id,
      subject: "Refund request — historic",
      channel: "chat",
      status: "open",
      priority: "medium",
      createdAt: REQUEST_TIME,
      messages: {
        create: [{ author: "customer", authorName: "Test", body: "Please refund.", sentAt: REQUEST_TIME }],
      },
    },
  });
  return ticket;
}

describe("loadTicketContext: requestedAt", () => {
  it("returns requestedAt exactly equal to the ticket's persisted createdAt", async () => {
    const ticket = await createHistoricTicket([5]);
    const loaded = await loadTicketContext(ticket.id);

    expect(loaded.accountContext.requestedAt).toBeInstanceOf(Date);
    expect(loaded.accountContext.requestedAt.getTime()).toBe(ticket.createdAt.getTime());
    expect(loaded.accountContext.requestedAt.getTime()).toBe(REQUEST_TIME.getTime());
  });

  it("is unaffected by later activity on the ticket (updatedAt / new messages do not move the anchor)", async () => {
    const ticket = await createHistoricTicket([5]);
    await db.message.create({
      data: { ticketId: ticket.id, author: "customer", authorName: "Test", body: "Any update?", sentAt: new Date(REQUEST_TIME.getTime() + 7 * DAY_MS) },
    });
    await db.ticket.update({ where: { id: ticket.id }, data: { subject: "Refund request — historic (edited)" } });

    const loaded = await loadTicketContext(ticket.id);
    expect(loaded.accountContext.requestedAt.getTime()).toBe(REQUEST_TIME.getTime());
  });
});

describe("real loaded context -> real Policy prompt", () => {
  async function policyPromptFor(ticketId: string): Promise<string> {
    const loaded = await loadTicketContext(ticketId);
    const seen: string[] = [];
    registerProvider(
      "anthropic",
      new MockProvider((request) => {
        seen.push(request.messages.at(-1)!.content);
        return { text: "not json", inputTokens: 1, outputTokens: 1 };
      }),
    );
    await policyAgent.run({
      ticketId: loaded.ticketId,
      classification: makeClassification({ intent: "refund_request", domains: ["billing", "policy"] }),
      ticketSummary: loaded.ticketSummary,
      conversation: loaded.conversation,
      accountContext: loaded.accountContext,
      priorFindings: [],
    });
    expect(seen.length).toBeGreaterThan(0);
    return seen[0];
  }

  const printed = (prompt: string) =>
    prompt.match(/^- Days from the most recent successful charge to the customer's request.*: (.+)$/m)?.[1];

  it("prints 5 for a charge 5 days before a 2019 request, regardless of today's date", async () => {
    const ticket = await createHistoricTicket([5]);
    expect(printed(await policyPromptFor(ticket.id))).toBe("5");
  });

  it("ignores a later charge on the same account (a renewal after the request)", async () => {
    // 5 days before the request, and 2 days after it.
    const ticket = await createHistoricTicket([5, -2]);
    expect(printed(await policyPromptFor(ticket.id))).toBe("5");
  });

  it("prints n/a when no charge precedes the request", async () => {
    const ticket = await createHistoricTicket([-3]);
    expect(printed(await policyPromptFor(ticket.id))).toMatch(/^n\/a/);
  });
});
