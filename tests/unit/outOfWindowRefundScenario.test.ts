import { afterEach, describe, expect, it, vi } from "vitest";
import { EvaluationExpectedOutcomeSchema } from "@/lib/ai/schemas";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { MockProvider } from "@/lib/ai/providers/mock";
import { scoreOutcome } from "@/lib/evaluation/score";
import { daysSince, detectDuplicateCharges, mostRecentSucceededCharge } from "@/lib/orchestrator/evidence";
import { runOrchestration } from "@/lib/orchestrator/orchestrator";
import { selectAgents } from "@/lib/orchestrator/selectAgents";
import { POLICIES } from "../../prisma/data/policies";
import { SCENARIOS } from "../../prisma/data/scenarios";
import { FIXTURES, scenarioKeyForTicketSummary, taskForSystemPrompt } from "../../scripts/evaluationDryRunFixtures";
import { makeAccountContext, makeClassification } from "./testSupport/fixtures";

/**
 * `out-of-window-refund` restores END-TO-END coverage of the Refund Policy's
 * 14-90 day path: a request outside every explicit condition must be marked
 * `requires_review` (Billing Ops approval), not auto-denied. After
 * `prohibited-refund` was redesigned around condition 3 (DECISIONS.md), that
 * path had unit-level coverage only. These tests guard the scenario's facts,
 * its determinism, and its wiring through the real orchestrator and scorer;
 * they do not measure a live model, which only an evaluation run does.
 */
afterEach(() => {
  vi.useRealTimers();
  _resetProvidersForTests();
});

const KEY = "out-of-window-refund";
const scenario = SCENARIOS.find((s) => s.key === KEY)!;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The 10 scenarios that existed before this one, in their original order. */
const ORIGINAL_KEYS = [
  "password-reset",
  "duplicate-billing",
  "prohibited-refund",
  "legitimate-refund",
  "failed-payment",
  "known-technical-issue",
  "technical-escalation",
  "suspicious-activity",
  "ambiguous-request",
  "multi-domain",
];

describe("registration", () => {
  it("is registered exactly once, as the 11th scenario, with unique keys and subjects", () => {
    expect(scenario).toBeDefined();
    expect(SCENARIOS).toHaveLength(11);
    expect(new Set(SCENARIOS.map((s) => s.key)).size).toBe(11);
    expect(new Set(SCENARIOS.map((s) => s.ticket.subject)).size).toBe(11); // the dry-run fixtures key on the subject
    expect(new Set(SCENARIOS.map((s) => s.customer.email)).size).toBe(11); // Customer.email is unique in the schema
  });

  it("leaves the 10 existing scenarios in their original order, with the new one last", () => {
    // Order matters: seed.ts draws one rng value per scenario before generating any background
    // customer, so appending keeps every existing scenario's seeded data identical.
    expect(SCENARIOS.map((s) => s.key)).toEqual([...ORIGINAL_KEYS, KEY]);
  });

  it("has the specified expected outcome, valid under the existing schema", () => {
    expect(EvaluationExpectedOutcomeSchema.safeParse(scenario.expectedOutcome).success).toBe(true);
    expect(scenario.expectedOutcome).toMatchObject({
      expectedIntent: "refund_request",
      expectedAgents: ["billing", "policy", "response"],
      expectedPolicySlug: "refund-policy",
      expectedEscalation: true,
      expectedAction: "escalate",
    });
  });

  it("has a dry-run fixture entry, so the harness can run all 11 scenarios", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(SCENARIOS.map((s) => s.key).sort());
    expect(scenarioKeyForTicketSummary(`Ticket: ${scenario.ticket.subject}`)).toBe(KEY);
  });
});

describe("the facts are an ordinary out-of-window subscription refund, and nothing else", () => {
  const message = scenario.messages.map((m) => m.body).join(" ");
  const ticketText = `${scenario.ticket.subject} ${message}`;

  it("has one ordinary succeeded charge: no duplicate, no usage-based reason, no other activity", () => {
    expect(scenario.transactions).toHaveLength(1);
    expect(scenario.invoices).toHaveLength(1);
    const [tx] = scenario.transactions;
    expect(tx).toMatchObject({ type: "charge", status: "succeeded" });
    expect(tx.reason).toBeUndefined(); // not "api_overage" or any other usage-based marker
    expect(scenario.invoices[0].status).toBe("paid");
    const asContext = scenario.transactions.map((t) => ({
      type: t.type,
      status: t.status,
      amountCents: t.amountCents,
      reason: t.reason ?? null,
      occurredAt: new Date(Date.UTC(2020, 0, 1) - t.occurredDaysAgo * DAY_MS),
      invoiceNumber: null,
    }));
    expect(detectDuplicateCharges(asContext)).toEqual([]);
  });

  it("clearly requests a refund", () => {
    expect(ticketText).toMatch(/refund/i);
    expect(message).toMatch(/would like to request a refund/i);
  });

  it("uses none of the wording that would invoke another condition or the ambiguous seeded phrasing", () => {
    // usage / overage (condition 3), downgrade / cancellation (condition 4 and the Cancellation Policy),
    // duplicates (condition 2), and the "switching tools" phrasing the seeded templates treat inconsistently.
    expect(ticketText).not.toMatch(/overage|metered|usage|used|api|batch/i);
    expect(ticketText).not.toMatch(/downgrad|drop back|fewer seats|remove[d]? (seats|users)|mid-?cycle|cancel|terminate|end (of )?(our )?(subscription|contract)/i);
    expect(ticketText).not.toMatch(/twice|duplicate|double|again/i);
    expect(ticketText).not.toMatch(/switch|different tool|another (tool|product|vendor)|moving to|competitor/i);
    expect(ticketText).not.toMatch(/error|bug|broken|unauthori[sz]ed|fraud|suspicious/i);
  });

  it("is a low-risk, neutral, non-security ticket, so no Risk routing is implied", () => {
    expect(scenario.account.riskScore).toBeLessThan(50);
    expect(scenario.account.status).toBe("active");
    expect(scenario.ticket.priority).toBe("medium");
  });
});

describe("request-time behavior is deterministic (DECISIONS.md, 'Reference time')", () => {
  // Built from an arbitrary anchor (2019), deliberately not the seed's nor today's.
  const ANCHOR = new Date("2019-03-20T12:00:00.000Z");
  const requestedAt = ANCHOR; // Ticket.createdAt is seeded at daysAgo(0)
  const transactions = scenario.transactions.map((t) => ({
    type: t.type,
    status: t.status,
    amountCents: t.amountCents,
    reason: t.reason ?? null,
    occurredAt: new Date(ANCHOR.getTime() - t.occurredDaysAgo * DAY_MS),
    invoiceNumber: null,
  }));

  it("the request is 45 days after the charge", () => {
    const charge = mostRecentSucceededCharge(transactions, requestedAt)!;
    expect(daysSince(charge.occurredAt, requestedAt)).toBe(45);
    expect(scenario.messages[0].sentDaysAgo).toBe(0);
  });

  it("45 days is outside the 14-day condition and under 90 on EVERY reading of the '90 days' exception", () => {
    const days = 45;
    expect(days).toBeGreaterThan(14 + 1); // clear of the 14-day boundary and of rounding
    expect(days).toBeLessThan(90); // fewer than 90 days after the charge
    expect(days - 14).toBeLessThan(90); // fewer than 90 days beyond the 14-day window (the stricter reading)
  });

  it("the customer's own '45 days ago' matches the derived count", () => {
    const stated = [...scenario.messages[0].body.matchAll(/(\d+) days? ago/g)].map((m) => Number(m[1]));
    expect(stated).toEqual([45]);
  });
});

describe("through the real orchestrator and scorer, with the scenario's own dry-run fixture", () => {
  const ANCHOR = new Date("2019-03-20T12:00:00.000Z");

  function accountContext() {
    return makeAccountContext({
      requestedAt: ANCHOR,
      policies: POLICIES.map((p) => ({ slug: p.slug, title: p.title, category: p.category, body: p.body })),
      transactions: scenario.transactions.map((t) => ({
        type: t.type,
        status: t.status,
        amountCents: t.amountCents,
        reason: t.reason ?? null,
        occurredAt: new Date(ANCHOR.getTime() - t.occurredDaysAgo * DAY_MS),
        invoiceNumber: null,
      })),
    });
  }

  async function run() {
    const policyPrompts: string[] = [];
    registerProvider(
      "anthropic",
      new MockProvider((request) => {
        const task = taskForSystemPrompt(request.system);
        const user = request.messages.at(-1)?.content ?? "";
        if (task === "policy_agent_finding") policyPrompts.push(user);
        const text = task ? FIXTURES[KEY]?.[task] : undefined;
        if (!text) throw new Error(`no fixture for task ${task}`);
        return { text, inputTokens: 1, outputTokens: 1 };
      }),
    );
    const outcome = await runOrchestration({
      ticketId: "test-ticket",
      ticketSummary: scenario.ticket.subject,
      conversation: scenario.messages.map((m) => ({ author: m.author, body: m.body })),
      accountContext: accountContext(),
    });
    return { outcome, policyPrompts };
  }

  it("selects billing + policy + response for the classification a correct classifier would produce", () => {
    const routed = selectAgents(makeClassification({ intent: "refund_request", domains: ["billing", "policy"] }));
    expect(routed).toEqual(scenario.expectedOutcome.expectedAgents);
    // and the intent override alone still guarantees Policy even if the classifier only flags billing:
    expect(selectAgents(makeClassification({ intent: "refund_request", domains: ["billing"] }))).toEqual(
      scenario.expectedOutcome.expectedAgents,
    );
  });

  it("a requires_review Policy decision becomes an escalation to Billing Ops", async () => {
    const { outcome } = await run();
    expect(outcome.agentsInvoked).toEqual(["billing", "policy", "response"]);
    expect(outcome.resolution.action).toBe("escalate");
    expect(outcome.resolution.requiresHumanReview).toBe(true);
    expect(outcome.escalation).toMatchObject({ required: true, targetTeam: "billing_ops" });
  });

  it("the real Policy prompt carries the real Refund Policy and the 45-day request-time count", async () => {
    const { policyPrompts } = await run();
    expect(policyPrompts).toHaveLength(1);
    expect(policyPrompts[0]).toContain("rather than auto-denied"); // the catch-all is what governs this ticket
    expect(policyPrompts[0]).toMatch(/customer's request \(request made 2019-03-20T12:00:00\.000Z\): 45/);
  });

  it("the Response agent's reply does not promise a refund (the resolution authorizes none)", async () => {
    const { outcome } = await run();
    expect(outcome.response?.body).toBeTruthy();
    expect(outcome.response?.body).not.toMatch(/refund\w*.*(process|issu|approv|grant|credit)/i);
  });

  it("scores 1.00 and passes, so the scenario, fixture and scorer agree", async () => {
    const { outcome } = await run();
    const scores = scoreOutcome(scenario.expectedOutcome, outcome);
    expect(scores).toMatchObject({
      classificationCorrect: true,
      routingCorrect: true,
      policyCorrect: true,
      escalationCorrect: true,
      resolutionCorrect: true,
    });
    expect(scores.overallScore).toBe(1);
  });

  it("gives the same outcome whatever the wall clock reads (no drift)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2041-06-15T18:45:00.000Z"));
    const { outcome, policyPrompts } = await run();
    expect(outcome.resolution.action).toBe("escalate");
    expect(policyPrompts[0]).toMatch(/: 45\n/);
  });
});
