import { db } from "@/lib/db";

/**
 * Everything pre-fetched from the database for one orchestration run.
 * Agents narrow this to the slice they actually need when building their
 * prompts (see prompts.ts) — this is the "receive only the context it
 * actually needs" requirement, applied at the prompt-construction layer
 * rather than by re-querying per agent, since it's one ticket's worth of
 * data and re-fetching per agent would just be N near-identical queries.
 */
export interface TicketDataContext {
  /** When the customer made the request: the ticket's persisted `createdAt`
   * (first contact). Business-derived time facts — e.g. days from a charge
   * to a refund request — are measured to this instant, never to the wall
   * clock, so a ticket analyzed (or re-analyzed) days later, or replayed in
   * an evaluation, yields the same facts. See DECISIONS.md ("Reference time:
   * business-derived time facts come from persisted event data"). */
  requestedAt: Date;
  customer: {
    name: string;
    email: string;
    company: string;
  };
  account: {
    plan: string;
    status: string;
    mrrCents: number;
    riskScore: number;
  } | null;
  subscriptions: Array<{
    status: string;
    startedAt: Date;
    renewsAt: Date;
    canceledAt: Date | null;
    items: Array<{ productName: string; quantity: number }>;
  }>;
  invoices: Array<{
    number: string;
    status: string;
    amountCents: number;
    issuedAt: Date;
    dueAt: Date;
    paidAt: Date | null;
  }>;
  transactions: Array<{
    type: string;
    status: string;
    amountCents: number;
    reason: string | null;
    occurredAt: Date;
    invoiceNumber: string | null;
  }>;
  policies: Array<{ slug: string; title: string; category: string; body: string }>;
  productDocs: Array<{ slug: string; title: string; product: string; body: string }>;
}

export interface LoadedTicket {
  ticketId: string;
  ticketSummary: string;
  conversation: { author: string; body: string }[];
  accountContext: TicketDataContext;
}

/** Loads and shapes everything an orchestration run needs for one ticket,
 * in one pass. See TicketDataContext for what agents can read from it. */
export async function loadTicketContext(ticketId: string): Promise<LoadedTicket> {
  const [ticket, policies, productDocs] = await Promise.all([
    db.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      include: {
        customer: {
          include: {
            account: {
              include: {
                subscriptions: { include: { items: { include: { product: true } } } },
                invoices: { orderBy: { issuedAt: "desc" } },
                transactions: { orderBy: { occurredAt: "desc" }, include: { invoice: true } },
              },
            },
          },
        },
        messages: { orderBy: { sentAt: "asc" } },
      },
    }),
    db.policy.findMany(),
    db.productDoc.findMany(),
  ]);

  const account = ticket.customer.account;

  const accountContext: TicketDataContext = {
    requestedAt: ticket.createdAt,
    customer: {
      name: ticket.customer.name,
      email: ticket.customer.email,
      company: ticket.customer.company,
    },
    account: account
      ? { plan: account.plan, status: account.status, mrrCents: account.mrrCents, riskScore: account.riskScore }
      : null,
    subscriptions: (account?.subscriptions ?? []).map((sub) => ({
      status: sub.status,
      startedAt: sub.startedAt,
      renewsAt: sub.renewsAt,
      canceledAt: sub.canceledAt,
      items: sub.items.map((item) => ({ productName: item.product.name, quantity: item.quantity })),
    })),
    invoices: (account?.invoices ?? []).map((inv) => ({
      number: inv.number,
      status: inv.status,
      amountCents: inv.amountCents,
      issuedAt: inv.issuedAt,
      dueAt: inv.dueAt,
      paidAt: inv.paidAt,
    })),
    transactions: (account?.transactions ?? []).map((tx) => ({
      type: tx.type,
      status: tx.status,
      amountCents: tx.amountCents,
      reason: tx.reason,
      occurredAt: tx.occurredAt,
      invoiceNumber: tx.invoice?.number ?? null,
    })),
    policies: policies.map((p) => ({ slug: p.slug, title: p.title, category: p.category, body: p.body })),
    productDocs: productDocs.map((d) => ({ slug: d.slug, title: d.title, product: d.product, body: d.body })),
  };

  return {
    ticketId: ticket.id,
    ticketSummary: ticket.subject,
    conversation: ticket.messages.map((m) => ({ author: m.author, body: m.body })),
    accountContext,
  };
}
