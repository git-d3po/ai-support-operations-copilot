/**
 * Deterministic synthetic-data seed script.
 *
 * Running `npm run db:seed` always produces the same dataset (same
 * customers, same tickets, same billing history) because every random
 * decision goes through `createRng(SEED)` — see src/lib/synthetic/rng.ts.
 * This is what makes the app's demo state and the evaluation suite's
 * fixtures reproducible across machines and over time.
 *
 * The script is safe to re-run: it clears prior data (in dependency order)
 * before regenerating.
 */
import "dotenv/config";
import { faker } from "@faker-js/faker";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { createRng, SEED } from "../src/lib/synthetic/rng";
import { PRODUCTS, PLAN_BUNDLES, type Plan } from "./data/products";
import { POLICIES } from "./data/policies";
import { PRODUCT_DOCS } from "./data/productDocs";
import { SCENARIOS, type ScenarioInvoiceFixture, type ScenarioTransactionFixture } from "./data/scenarios";
import { TICKET_TEMPLATES } from "./data/ticketTemplates";
import type { TicketIntent } from "../src/lib/ai/schemas";
import { DATABASE_URL } from "../src/lib/databaseUrl";

const adapter = new PrismaBetterSqlite3({ url: DATABASE_URL });
const db = new PrismaClient({ adapter });
const rng = createRng(SEED);
const NOW = new Date("2026-09-18T12:00:00.000Z");

const BACKGROUND_CUSTOMER_COUNT = 90;
const PLAN_WEIGHTS: [Plan, number][] = [
  ["starter", 35],
  ["growth", 35],
  ["scale", 20],
  ["enterprise", 10],
];
const STATUS_WEIGHTS: [string, number][] = [
  ["active", 85],
  ["past_due", 8],
  ["canceled", 5],
  ["trialing", 2],
];
const TICKET_INTENT_WEIGHTS: [TicketIntent, number][] = [
  ["password_reset", 12],
  ["duplicate_charge", 6],
  ["refund_request", 8],
  ["failed_payment", 8],
  ["billing_question", 14],
  ["technical_issue", 20],
  ["account_security", 6],
  ["cancellation", 6],
  ["feature_question", 12],
  ["general_inquiry", 8],
];
const TICKET_STATUS_WEIGHTS: [string, number][] = [
  ["open", 30],
  ["pending", 15],
  ["escalated", 10],
  ["resolved", 30],
  ["closed", 15],
];
const TICKET_PRIORITY_WEIGHTS: [string, number][] = [
  ["low", 30],
  ["medium", 40],
  ["high", 20],
  ["urgent", 10],
];
const CHANNEL_WEIGHTS: [string, number][] = [
  ["email", 50],
  ["chat", 35],
  ["in_app", 15],
];

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function mrrForPlan(plan: Plan, seats: number): number {
  const seatPrice = PRODUCTS.find((p) => p.sku === "CORE-SEAT")!.priceCents;
  const bundleCost = PLAN_BUNDLES[plan].reduce((sum, sku) => {
    const product = PRODUCTS.find((p) => p.sku === sku)!;
    return sum + product.priceCents;
  }, 0);
  return seats * seatPrice + bundleCost;
}

function seatsForPlan(plan: Plan): number {
  switch (plan) {
    case "starter":
      return rng.int(1, 5);
    case "growth":
      return rng.int(5, 20);
    case "scale":
      return rng.int(15, 60);
    case "enterprise":
      return rng.int(40, 200);
  }
}

async function resetDatabase() {
  // Reverse dependency order.
  await db.evaluationResult.deleteMany();
  await db.evaluationCase.deleteMany();
  await db.agentInvocation.deleteMany();
  await db.orchestrationRun.deleteMany();
  await db.message.deleteMany();
  await db.ticket.deleteMany();
  await db.transaction.deleteMany();
  await db.invoice.deleteMany();
  await db.subscriptionItem.deleteMany();
  await db.subscription.deleteMany();
  await db.account.deleteMany();
  await db.customer.deleteMany();
  await db.productDoc.deleteMany();
  await db.policy.deleteMany();
  await db.product.deleteMany();
}

async function seedReferenceData() {
  await db.product.createMany({ data: PRODUCTS });
  await db.policy.createMany({ data: POLICIES });
  await db.productDoc.createMany({ data: PRODUCT_DOCS });
}

interface BillingGraphArgs {
  accountId: string;
  subscriptionId: string;
  invoices: ScenarioInvoiceFixture[];
  transactions: ScenarioTransactionFixture[];
}

/** Creates Invoice + Transaction rows from fixture arrays, wiring up the
 * transaction→invoice link by array index. Shared by curated scenarios and
 * procedurally generated background accounts. */
async function materializeBilling({ accountId, subscriptionId, invoices, transactions }: BillingGraphArgs) {
  const invoiceIds: string[] = [];
  for (const [index, inv] of invoices.entries()) {
    const invoice = await db.invoice.create({
      data: {
        accountId,
        subscriptionId,
        number: `INV-${accountId.slice(-6).toUpperCase()}-${index + 1}`,
        status: inv.status,
        amountCents: inv.amountCents,
        issuedAt: daysAgo(inv.issuedDaysAgo),
        dueAt: daysAgo(inv.dueDaysAgo),
        paidAt: inv.paidDaysAgo !== undefined ? daysAgo(inv.paidDaysAgo) : null,
      },
    });
    invoiceIds.push(invoice.id);
  }

  for (const tx of transactions) {
    await db.transaction.create({
      data: {
        accountId,
        invoiceId: tx.invoiceIndex !== undefined ? invoiceIds[tx.invoiceIndex] : null,
        type: tx.type,
        status: tx.status,
        amountCents: tx.amountCents,
        reason: tx.reason ?? null,
        occurredAt: daysAgo(tx.occurredDaysAgo),
      },
    });
  }
}

async function seedCuratedScenarios() {
  for (const scenario of SCENARIOS) {
    const customer = await db.customer.create({
      data: {
        name: scenario.customer.name,
        email: scenario.customer.email,
        company: scenario.customer.company,
        timezone: scenario.customer.timezone,
        locale: scenario.customer.locale,
        createdAt: daysAgo(scenario.subscription.startedDaysAgo + rng.int(0, 5)),
      },
    });

    const account = await db.account.create({
      data: {
        customerId: customer.id,
        plan: scenario.account.plan,
        status: scenario.account.status,
        mrrCents: scenario.account.mrrCents,
        riskScore: scenario.account.riskScore,
        createdAt: daysAgo(scenario.subscription.startedDaysAgo),
      },
    });

    const subscription = await db.subscription.create({
      data: {
        accountId: account.id,
        status: scenario.subscription.status,
        startedAt: daysAgo(scenario.subscription.startedDaysAgo),
        renewsAt: daysAgo(-scenario.subscription.renewsInDays),
      },
    });

    const seats = seatsForPlan(scenario.account.plan);
    const coreProduct = await db.product.findUniqueOrThrow({ where: { sku: "CORE-SEAT" } });
    await db.subscriptionItem.create({
      data: { subscriptionId: subscription.id, productId: coreProduct.id, quantity: seats },
    });
    for (const sku of PLAN_BUNDLES[scenario.account.plan]) {
      const product = await db.product.findUniqueOrThrow({ where: { sku } });
      await db.subscriptionItem.create({
        data: { subscriptionId: subscription.id, productId: product.id, quantity: 1 },
      });
    }

    await materializeBilling({
      accountId: account.id,
      subscriptionId: subscription.id,
      invoices: scenario.invoices,
      transactions: scenario.transactions,
    });

    const ticket = await db.ticket.create({
      data: {
        customerId: customer.id,
        subject: scenario.ticket.subject,
        channel: scenario.ticket.channel,
        status: "open",
        priority: scenario.ticket.priority,
        scenarioKey: scenario.key,
        createdAt: daysAgo(0),
      },
    });

    for (const message of scenario.messages) {
      await db.message.create({
        data: {
          ticketId: ticket.id,
          author: message.author,
          authorName: message.authorName,
          body: message.body,
          sentAt: daysAgo(message.sentDaysAgo),
        },
      });
    }

    await db.evaluationCase.create({
      data: {
        ticketId: ticket.id,
        scenarioKey: scenario.key,
        description: scenario.description,
        expectedOutcome: scenario.expectedOutcome,
      },
    });
  }
}

async function seedBackgroundCustomer(index: number) {
  const name = faker.person.fullName();
  const company = faker.company.name();
  const emailDomain = faker.internet.domainName();
  const customer = await db.customer.create({
    data: {
      name,
      email: faker.internet.email({ firstName: name.split(" ")[0], lastName: `c${index}`, provider: emailDomain }).toLowerCase(),
      company,
      timezone: rng.pick([
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "Europe/London",
        "Europe/Berlin",
        "Asia/Singapore",
        "Australia/Sydney",
      ]),
      locale: rng.pick(["en-US", "en-GB", "en-AU", "de-DE"]),
      createdAt: rng.pastDate(NOW, 30, 900),
    },
  });

  const plan = rng.weighted(PLAN_WEIGHTS);
  const status = rng.weighted(STATUS_WEIGHTS) as "active" | "past_due" | "canceled" | "trialing";
  const seats = seatsForPlan(plan);
  const mrrCents = mrrForPlan(plan, seats);
  const riskScore =
    status === "past_due" ? rng.int(40, 75) : status === "canceled" ? rng.int(50, 90) : rng.int(0, 45);

  const startedDaysAgo = rng.int(10, 800);
  const account = await db.account.create({
    data: {
      customerId: customer.id,
      plan,
      status,
      mrrCents,
      riskScore,
      createdAt: daysAgo(startedDaysAgo),
    },
  });

  const canceledAt = status === "canceled" ? daysAgo(rng.int(1, Math.min(30, startedDaysAgo))) : null;
  const subscription = await db.subscription.create({
    data: {
      accountId: account.id,
      status: status === "canceled" ? "canceled" : status === "past_due" ? "past_due" : "active",
      startedAt: daysAgo(startedDaysAgo),
      renewsAt: canceledAt ?? daysAgo(-rng.int(1, 30)),
      canceledAt,
    },
  });

  const coreProduct = await db.product.findUniqueOrThrow({ where: { sku: "CORE-SEAT" } });
  await db.subscriptionItem.create({
    data: { subscriptionId: subscription.id, productId: coreProduct.id, quantity: seats },
  });
  for (const sku of PLAN_BUNDLES[plan]) {
    const product = await db.product.findUniqueOrThrow({ where: { sku } });
    await db.subscriptionItem.create({
      data: { subscriptionId: subscription.id, productId: product.id, quantity: 1 },
    });
  }

  // Historical monthly invoices, most recent first constraint respected by
  // construction (we build oldest-to-newest below).
  const invoiceCount = Math.min(rng.int(3, 8), Math.floor(startedDaysAgo / 30));
  const invoices: ScenarioInvoiceFixture[] = [];
  for (let i = invoiceCount; i >= 1; i--) {
    const issuedDaysAgo = i * 30;
    const isMostRecent = i === 1;
    if (isMostRecent && status === "past_due") {
      invoices.push({ status: "past_due", amountCents: mrrCents, issuedDaysAgo, dueDaysAgo: issuedDaysAgo - 7 });
    } else {
      invoices.push({
        status: "paid",
        amountCents: mrrCents,
        issuedDaysAgo,
        dueDaysAgo: issuedDaysAgo - 7,
        paidDaysAgo: issuedDaysAgo - 6,
      });
    }
  }

  const transactions: ScenarioTransactionFixture[] = invoices.map((inv, idx) => {
    if (inv.status === "past_due") {
      return {
        type: "charge",
        status: "failed",
        amountCents: inv.amountCents,
        reason: rng.pick(["insufficient_funds", "card_declined", "expired_card"]),
        occurredDaysAgo: inv.dueDaysAgo,
        invoiceIndex: idx,
      };
    }
    return {
      type: "charge",
      status: "succeeded",
      amountCents: inv.amountCents,
      occurredDaysAgo: inv.paidDaysAgo ?? inv.issuedDaysAgo,
      invoiceIndex: idx,
    };
  });

  // A small amount of realistic transaction texture: occasional refunds on
  // otherwise-healthy accounts, occasional chargebacks on risky ones.
  if (invoices.length > 0 && rng.chance(0.06)) {
    transactions.push({
      type: "refund",
      status: "succeeded",
      amountCents: -Math.round(invoices[0].amountCents * rng.float() * 0.5),
      occurredDaysAgo: Math.max(1, invoices[0].issuedDaysAgo - 2),
      invoiceIndex: 0,
    });
  }
  if (riskScore > 60 && rng.chance(0.15)) {
    transactions.push({
      type: "chargeback",
      status: "succeeded",
      amountCents: -(invoices[0]?.amountCents ?? 0),
      occurredDaysAgo: Math.max(1, (invoices[0]?.issuedDaysAgo ?? 30) - 1),
      invoiceIndex: invoices.length > 0 ? 0 : undefined,
    });
  }

  await materializeBilling({ accountId: account.id, subscriptionId: subscription.id, invoices, transactions });

  const ticketCount = rng.weighted<number>([
    [0, 35],
    [1, 40],
    [2, 20],
    [3, 5],
  ]);

  for (let t = 0; t < ticketCount; t++) {
    const intent = rng.weighted(TICKET_INTENT_WEIGHTS);
    const template = rng.pick(TICKET_TEMPLATES[intent]);
    const ticketStatus = rng.weighted(TICKET_STATUS_WEIGHTS);
    const priority = rng.weighted(TICKET_PRIORITY_WEIGHTS);
    const channel = rng.weighted(CHANNEL_WEIGHTS);
    const createdDaysAgo = rng.int(0, 180);

    const ticket = await db.ticket.create({
      data: {
        customerId: customer.id,
        subject: template.subject,
        channel,
        status: ticketStatus,
        priority,
        createdAt: daysAgo(createdDaysAgo),
        updatedAt: daysAgo(Math.max(0, createdDaysAgo - rng.int(0, createdDaysAgo))),
      },
    });

    await db.message.create({
      data: {
        ticketId: ticket.id,
        author: "customer",
        authorName: name,
        body: template.customerBody,
        sentAt: daysAgo(createdDaysAgo),
      },
    });

    if (["resolved", "closed", "pending"].includes(ticketStatus)) {
      await db.message.create({
        data: {
          ticketId: ticket.id,
          author: "agent",
          authorName: rng.pick(["Morgan Reyes", "Alex Kim", "Jamie Fox", "Taylor Brooks"]),
          body: template.agentBody,
          sentAt: daysAgo(Math.max(0, createdDaysAgo - rng.int(0, 2))),
        },
      });
    }
  }
}

async function main() {
  console.log(`Seeding with fixed SEED=${SEED} (anchor date ${NOW.toISOString()})`);
  faker.seed(SEED);

  await resetDatabase();
  await seedReferenceData();
  await seedCuratedScenarios();

  for (let i = 0; i < BACKGROUND_CUSTOMER_COUNT; i++) {
    await seedBackgroundCustomer(i);
  }

  const [customerCount, ticketCount, invoiceCount, evalCaseCount] = await Promise.all([
    db.customer.count(),
    db.ticket.count(),
    db.invoice.count(),
    db.evaluationCase.count(),
  ]);
  console.log(
    `Seeded ${customerCount} customers, ${ticketCount} tickets (${evalCaseCount} curated evaluation cases), ${invoiceCount} invoices.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
