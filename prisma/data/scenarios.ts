import type { EvaluationExpectedOutcome } from "@/lib/ai/schemas";
import type { Plan } from "./products";

/**
 * The 10 curated demonstration tickets. Each one is grounded in specific,
 * hand-authored account/billing/conversation data so that a correct AI
 * analysis is actually determinable — these are what EVALUATION.md scores
 * the orchestrator against, not just a UI feature list.
 *
 * Every curated ticket seeds as `status: "open"` so the demo can run "AI
 * analysis" on it live rather than showing a pre-baked result.
 */

export interface ScenarioInvoiceFixture {
  status: "paid" | "open" | "past_due" | "void" | "refunded";
  amountCents: number;
  issuedDaysAgo: number;
  dueDaysAgo: number;
  paidDaysAgo?: number;
}

export interface ScenarioTransactionFixture {
  type: "charge" | "refund" | "chargeback" | "payout_failure";
  status: "succeeded" | "failed" | "pending";
  amountCents: number;
  occurredDaysAgo: number;
  reason?: string;
  /** Index into this scenario's `invoices` array, if linked. */
  invoiceIndex?: number;
}

export interface ScenarioMessageFixture {
  author: "customer" | "agent" | "system";
  authorName: string;
  body: string;
  sentDaysAgo: number;
}

export interface ScenarioSeed {
  key: string;
  description: string;
  customer: {
    name: string;
    email: string;
    company: string;
    timezone: string;
    locale: string;
  };
  account: {
    plan: Plan;
    status: "active" | "past_due" | "canceled" | "trialing";
    mrrCents: number;
    riskScore: number;
  };
  subscription: {
    status: "active" | "trialing" | "past_due" | "canceled";
    startedDaysAgo: number;
    renewsInDays: number;
  };
  invoices: ScenarioInvoiceFixture[];
  transactions: ScenarioTransactionFixture[];
  ticket: {
    subject: string;
    channel: "email" | "chat" | "in_app";
    priority: "low" | "medium" | "high" | "urgent";
  };
  messages: ScenarioMessageFixture[];
  expectedOutcome: EvaluationExpectedOutcome;
}

export const SCENARIOS: ScenarioSeed[] = [
  {
    key: "password-reset",
    description: "Standard password reset request with no security flags on the account.",
    customer: {
      name: "Priya Natarajan",
      email: "priya@brightloop.io",
      company: "Brightloop",
      timezone: "America/Chicago",
      locale: "en-US",
    },
    account: { plan: "growth", status: "active", mrrCents: 29700, riskScore: 10 },
    subscription: { status: "active", startedDaysAgo: 220, renewsInDays: 15 },
    invoices: [{ status: "paid", amountCents: 29700, issuedDaysAgo: 15, dueDaysAgo: 15, paidDaysAgo: 15 }],
    transactions: [{ type: "charge", status: "succeeded", amountCents: 29700, occurredDaysAgo: 15, invoiceIndex: 0 }],
    ticket: { subject: "Forgot my password — can't log in", channel: "email", priority: "medium" },
    messages: [
      {
        author: "customer",
        authorName: "Priya Natarajan",
        body: "I forgot my password and can't log in. Can you help me reset it?",
        sentDaysAgo: 0,
      },
    ],
    expectedOutcome: {
      expectedIntent: "password_reset",
      expectedAgents: ["technical", "response"],
      expectedPolicySlug: null,
      expectedEscalation: false,
      expectedAction: "auto_resolve",
      notes: "No security flags on the account; standard reset flow applies per Account Security Policy.",
    },
  },
  {
    key: "duplicate-billing",
    description: "Two identical charges on the same invoice within hours — a textbook duplicate charge.",
    customer: {
      name: "Marcus Webb",
      email: "marcus@fieldstonelogistics.com",
      company: "Fieldstone Logistics",
      timezone: "America/New_York",
      locale: "en-US",
    },
    account: { plan: "scale", status: "active", mrrCents: 39900, riskScore: 15 },
    subscription: { status: "active", startedDaysAgo: 300, renewsInDays: 3 },
    invoices: [{ status: "paid", amountCents: 39900, issuedDaysAgo: 3, dueDaysAgo: 3, paidDaysAgo: 3 }],
    transactions: [
      { type: "charge", status: "succeeded", amountCents: 39900, occurredDaysAgo: 3, invoiceIndex: 0 },
      { type: "charge", status: "succeeded", amountCents: 39900, occurredDaysAgo: 3, invoiceIndex: 0 },
    ],
    ticket: { subject: "Charged twice this billing cycle", channel: "email", priority: "high" },
    messages: [
      {
        author: "customer",
        authorName: "Marcus Webb",
        body: "We were charged $399.00 twice on the same day for this month's Scale plan invoice. Please refund the duplicate charge.",
        sentDaysAgo: 0,
      },
    ],
    expectedOutcome: {
      expectedIntent: "duplicate_charge",
      expectedAgents: ["billing", "policy", "response"],
      expectedPolicySlug: "duplicate-charge-policy",
      expectedEscalation: false,
      expectedAction: "refund_customer",
      notes: "Two same-amount charges on one invoice within 48 hours — confirmed duplicate, fast-path refund.",
    },
  },
  {
    key: "prohibited-refund",
    description: "Refund requested well outside the 14-day window with clear evidence of prior usage.",
    customer: {
      name: "Dana Ruiz-Coleman",
      email: "dana@harborpointe.co",
      company: "Harborpointe Co",
      timezone: "America/Denver",
      locale: "en-US",
    },
    account: { plan: "enterprise", status: "active", mrrCents: 149900, riskScore: 20 },
    subscription: { status: "active", startedDaysAgo: 210, renewsInDays: 155 },
    invoices: [{ status: "paid", amountCents: 1799000, issuedDaysAgo: 210, dueDaysAgo: 210, paidDaysAgo: 210 }],
    transactions: [{ type: "charge", status: "succeeded", amountCents: 1799000, occurredDaysAgo: 210, invoiceIndex: 0 }],
    ticket: { subject: "Requesting refund for our annual plan", channel: "email", priority: "medium" },
    messages: [
      {
        author: "customer",
        authorName: "Dana Ruiz-Coleman",
        body: "We signed up for the annual Enterprise plan back in the spring and have been using it daily since, but we've decided to move to a different tool. Can we get a refund for the remaining months?",
        sentDaysAgo: 0,
      },
    ],
    expectedOutcome: {
      expectedIntent: "refund_request",
      expectedAgents: ["billing", "policy", "response"],
      expectedPolicySlug: "refund-policy",
      expectedEscalation: false,
      expectedAction: "deny_request",
      notes: "Charge occurred 210 days ago with acknowledged daily usage — well outside the 14-day, low-usage refund window.",
    },
  },
  {
    key: "legitimate-refund",
    description: "Refund requested within days of an accidental upgrade, before any meaningful usage.",
    customer: {
      name: "Sam Okafor",
      email: "sam@vertexcraft.com",
      company: "Vertexcraft",
      timezone: "America/Los_Angeles",
      locale: "en-US",
    },
    account: { plan: "growth", status: "active", mrrCents: 29700, riskScore: 12 },
    subscription: { status: "active", startedDaysAgo: 5, renewsInDays: 25 },
    invoices: [{ status: "paid", amountCents: 29700, issuedDaysAgo: 5, dueDaysAgo: 5, paidDaysAgo: 5 }],
    transactions: [{ type: "charge", status: "succeeded", amountCents: 29700, occurredDaysAgo: 5, invoiceIndex: 0 }],
    ticket: { subject: "Refund request — upgraded by mistake", channel: "chat", priority: "medium" },
    messages: [
      {
        author: "customer",
        authorName: "Sam Okafor",
        body: "We upgraded to the Growth plan by mistake 5 days ago and haven't logged in since. Could we get a refund and drop back to Starter?",
        sentDaysAgo: 0,
      },
    ],
    expectedOutcome: {
      expectedIntent: "refund_request",
      expectedAgents: ["billing", "policy", "response"],
      expectedPolicySlug: "refund-policy",
      expectedEscalation: false,
      expectedAction: "refund_customer",
      notes: "Charge occurred 5 days ago with no usage since — squarely inside the refund window.",
    },
  },
  {
    key: "failed-payment",
    description: "Card decline with the customer proactively saying they've already updated payment info.",
    customer: {
      name: "Elena Petrova",
      email: "elena@northgatepartners.com",
      company: "Northgate Partners",
      timezone: "Europe/London",
      locale: "en-GB",
    },
    account: { plan: "starter", status: "past_due", mrrCents: 5400, riskScore: 35 },
    subscription: { status: "past_due", startedDaysAgo: 90, renewsInDays: -3 },
    invoices: [{ status: "past_due", amountCents: 5400, issuedDaysAgo: 10, dueDaysAgo: 3 }],
    transactions: [
      { type: "charge", status: "failed", amountCents: 5400, occurredDaysAgo: 3, reason: "insufficient_funds", invoiceIndex: 0 },
    ],
    ticket: { subject: "Payment failed — updated my card, please retry", channel: "email", priority: "medium" },
    messages: [
      {
        author: "customer",
        authorName: "Elena Petrova",
        body: "I got a notice that my payment failed. I've already updated my card on file — can you confirm the charge goes through, or do I need to do anything else?",
        sentDaysAgo: 0,
      },
    ],
    expectedOutcome: {
      expectedIntent: "failed_payment",
      expectedAgents: ["billing", "response"],
      expectedPolicySlug: null,
      expectedEscalation: false,
      expectedAction: "reply_and_monitor",
      notes: "Card already updated by the customer; next retry is automatic, so the right action is to confirm and monitor, not to take a manual billing action.",
    },
  },
  {
    key: "known-technical-issue",
    description: "Automations stop firing after an upgrade — matches the known large-board reindex timeout issue.",
    customer: {
      name: "Jordan Blake",
      email: "jordan@meadowvale.io",
      company: "Meadowvale",
      timezone: "America/Chicago",
      locale: "en-US",
    },
    account: { plan: "scale", status: "active", mrrCents: 39900, riskScore: 18 },
    subscription: { status: "active", startedDaysAgo: 2, renewsInDays: 28 },
    invoices: [{ status: "paid", amountCents: 39900, issuedDaysAgo: 2, dueDaysAgo: 2, paidDaysAgo: 2 }],
    transactions: [{ type: "charge", status: "succeeded", amountCents: 39900, occurredDaysAgo: 2, invoiceIndex: 0 }],
    ticket: { subject: "Automations stopped firing right after our upgrade", channel: "email", priority: "high" },
    messages: [
      {
        author: "customer",
        authorName: "Jordan Blake",
        body: "We upgraded to Scale two days ago and now none of the automations on our main board are running. That board has grown to around 2,500 cards — nothing else changed on our end.",
        sentDaysAgo: 0,
      },
    ],
    expectedOutcome: {
      expectedIntent: "technical_issue",
      expectedAgents: ["technical", "response"],
      expectedPolicySlug: null,
      expectedEscalation: false,
      expectedAction: "reply_and_close",
      notes: "Board size (~2,500 cards) matches the known automation-timeout issue (ENG-4821); the documented workaround (split the board) applies and hasn't been tried yet.",
    },
  },
  {
    key: "technical-escalation",
    description: "Same known issue, but the documented workaround has already been tried and failed.",
    customer: {
      name: "Renata Silva",
      email: "renata@ashgrove.dev",
      company: "Ashgrove",
      timezone: "America/Sao_Paulo",
      locale: "pt-BR",
    },
    account: { plan: "enterprise", status: "active", mrrCents: 149900, riskScore: 25 },
    subscription: { status: "active", startedDaysAgo: 400, renewsInDays: 40 },
    invoices: [{ status: "paid", amountCents: 149900, issuedDaysAgo: 12, dueDaysAgo: 12, paidDaysAgo: 12 }],
    transactions: [{ type: "charge", status: "succeeded", amountCents: 149900, occurredDaysAgo: 12, invoiceIndex: 0 }],
    ticket: { subject: "Automations still broken after splitting the board like support suggested", channel: "email", priority: "urgent" },
    messages: [
      {
        author: "customer",
        authorName: "Renata Silva",
        body: "Following up from yesterday — we split the oversized board into two smaller boards exactly as your help article describes, but automations are still not firing on either one. This is blocking our team's daily workflow.",
        sentDaysAgo: 0,
      },
    ],
    expectedOutcome: {
      expectedIntent: "technical_issue",
      expectedAgents: ["technical", "risk", "response"],
      expectedPolicySlug: null,
      expectedEscalation: true,
      expectedAction: "escalate",
      notes: "Documented workaround already attempted and failed — per Escalation Policy this goes to Engineering with the board evidence, not back through the same workaround.",
    },
  },
  {
    key: "suspicious-activity",
    description: "Customer reports an unrecognized login and an API key they didn't create.",
    customer: {
      name: "Wallace Chen",
      email: "wallace@ridgemontfinancial.com",
      company: "Ridgemont Financial",
      timezone: "America/New_York",
      locale: "en-US",
    },
    account: { plan: "enterprise", status: "active", mrrCents: 249900, riskScore: 82 },
    subscription: { status: "active", startedDaysAgo: 500, renewsInDays: 60 },
    invoices: [{ status: "paid", amountCents: 249900, issuedDaysAgo: 20, dueDaysAgo: 20, paidDaysAgo: 20 }],
    transactions: [{ type: "charge", status: "succeeded", amountCents: 249900, occurredDaysAgo: 20, invoiceIndex: 0 }],
    ticket: { subject: "Unrecognized login and API key on our account", channel: "email", priority: "urgent" },
    messages: [
      {
        author: "customer",
        authorName: "Wallace Chen",
        body: "Our security team flagged a login from an unfamiliar location in another country, and there's an API key in our account settings none of us created. Please investigate immediately — we handle sensitive client data.",
        sentDaysAgo: 0,
      },
    ],
    expectedOutcome: {
      expectedIntent: "account_security",
      expectedAgents: ["risk", "response"],
      expectedPolicySlug: "account-security-policy",
      expectedEscalation: true,
      expectedAction: "escalate",
      notes: "Suspected account compromise must always escalate to Trust & Safety per Account Security Policy — support should not attempt direct resolution.",
    },
  },
  {
    key: "ambiguous-request",
    description: "Genuinely under-specified request with no prior context to disambiguate against.",
    customer: {
      name: "Casey Lin",
      email: "casey@thistlefield.com",
      company: "Thistlefield",
      timezone: "America/Chicago",
      locale: "en-US",
    },
    account: { plan: "starter", status: "active", mrrCents: 5400, riskScore: 20 },
    subscription: { status: "active", startedDaysAgo: 60, renewsInDays: 10 },
    invoices: [{ status: "paid", amountCents: 5400, issuedDaysAgo: 30, dueDaysAgo: 30, paidDaysAgo: 30 }],
    transactions: [{ type: "charge", status: "succeeded", amountCents: 5400, occurredDaysAgo: 30, invoiceIndex: 0 }],
    ticket: { subject: "question", channel: "chat", priority: "low" },
    messages: [
      {
        author: "customer",
        authorName: "Casey Lin",
        body: "Hey, quick question about the thing we talked about — can you help with that when you get a sec?",
        sentDaysAgo: 0,
      },
    ],
    expectedOutcome: {
      expectedIntent: "general_inquiry",
      expectedAgents: ["response"],
      expectedPolicySlug: null,
      expectedEscalation: false,
      expectedAction: "reply_and_monitor",
      notes: "No specific product area, account issue, or prior ticket reference — the correct move is a clarifying question, not a specialist investigation.",
    },
  },
  {
    key: "multi-domain",
    description: "A plan-upgrade proration bug causes both a duplicate charge and a broken automation in the same ticket.",
    customer: {
      name: "Talia Reyes",
      email: "talia@ironwoodstudio.com",
      company: "Ironwood Studio",
      timezone: "America/Chicago",
      locale: "en-US",
    },
    account: { plan: "scale", status: "active", mrrCents: 39900, riskScore: 22 },
    subscription: { status: "active", startedDaysAgo: 3, renewsInDays: 27 },
    invoices: [{ status: "paid", amountCents: 10000, issuedDaysAgo: 3, dueDaysAgo: 3, paidDaysAgo: 3 }],
    transactions: [
      { type: "charge", status: "succeeded", amountCents: 10000, occurredDaysAgo: 3, invoiceIndex: 0 },
      { type: "charge", status: "succeeded", amountCents: 10000, occurredDaysAgo: 3, invoiceIndex: 0 },
    ],
    ticket: { subject: "Double charged on upgrade, and automations broke at the same time", channel: "email", priority: "high" },
    messages: [
      {
        author: "customer",
        authorName: "Talia Reyes",
        body: "We upgraded to Scale 3 days ago. Two things went wrong: our board automations stopped running right after the upgrade, and I just noticed we were charged the $100 proration fee twice.",
        sentDaysAgo: 0,
      },
    ],
    expectedOutcome: {
      expectedIntent: "billing_question",
      expectedAgents: ["billing", "policy", "technical", "response"],
      expectedPolicySlug: "duplicate-charge-policy",
      expectedEscalation: false,
      expectedAction: "refund_customer",
      notes: "Two independent, resolvable issues from one upgrade: a confirmed duplicate proration charge (fast-path refund) and an automation issue needing the standard technical workaround. Neither requires escalation on its own.",
    },
  },
];
