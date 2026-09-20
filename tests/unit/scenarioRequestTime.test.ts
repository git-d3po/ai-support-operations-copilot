import { describe, expect, it } from "vitest";
import { daysSince, mostRecentSucceededCharge } from "@/lib/orchestrator/evidence";
import { SCENARIOS } from "../../prisma/data/scenarios";
import { FIXTURES } from "../../scripts/evaluationDryRunFixtures";

/**
 * Scenario-level consistency for the reference-time architecture (DECISIONS.md,
 * "Reference time: business-derived time facts come from persisted event
 * data"). The seed anchors every curated ticket's request time (`Ticket.createdAt`)
 * at its anchor date (`daysAgo(0)`) and each charge at `daysAgo(occurredDaysAgo)`,
 * so the day count the Policy agent is shown is `occurredDaysAgo` minus the
 * request's own offset — independent of the anchor and of today's date.
 *
 * This test builds those timestamps from an ARBITRARY anchor (deliberately not
 * the seed's, nor today's) and pushes them through the real evidence functions,
 * then checks every day count the scenario documents against the result: the
 * customer's own words, and the dry-run fixture's stated evidence. It reads the
 * scenario facts; it never edits them.
 */
const ANCHOR = new Date("2019-03-20T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(ANCHOR.getTime() - days * DAY_MS);

/** Request time = the ticket's first contact = its (only) customer message, at the anchor. */
function derivedDayCount(scenario: (typeof SCENARIOS)[number]): number | null {
  const requestedAt = daysAgo(0);
  const transactions = scenario.transactions.map((t) => ({
    type: t.type,
    status: t.status,
    amountCents: t.amountCents,
    reason: t.reason ?? null,
    occurredAt: daysAgo(t.occurredDaysAgo),
    invoiceNumber: null,
  }));
  const charge = mostRecentSucceededCharge(transactions, requestedAt);
  return charge ? daysSince(charge.occurredAt, requestedAt) : null;
}

describe("curated scenarios: request time and charge time produce the documented day count", () => {
  it("every scenario's customer messages are sent at the request instant (the seed's ticket createdAt)", () => {
    for (const scenario of SCENARIOS) {
      for (const message of scenario.messages.filter((m) => m.author === "customer")) {
        expect(message.sentDaysAgo, `${scenario.key} customer message`).toBe(0);
      }
    }
  });

  const refundScenarios = SCENARIOS.filter((s) => s.expectedOutcome.expectedPolicySlug === "refund-policy");

  it("covers the refund scenarios (legitimate-refund, out-of-window-refund and prohibited-refund)", () => {
    expect(refundScenarios.map((s) => s.key).sort()).toEqual(["legitimate-refund", "out-of-window-refund", "prohibited-refund"]);
  });

  it.each(refundScenarios.map((s) => [s.key, s] as const))(
    "%s: the day count in the customer's words and in the dry-run fixture equals the derived count",
    (key, scenario) => {
      const derived = derivedDayCount(scenario);
      expect(derived).not.toBeNull();

      // Any "N days ago" the customer states about the charge must match.
      const stated = scenario.messages
        .filter((m) => m.author === "customer")
        .flatMap((m) => [...m.body.matchAll(/(\d+) days? ago/g)].map((match) => Number(match[1])));
      for (const n of stated) expect(n, `${key}: customer says ${n} days ago`).toBe(derived);

      // Any "Days since most recent charge: N" the dry-run fixture asserts must match.
      const policyFixture = FIXTURES[key]?.policy_agent_finding;
      expect(policyFixture, `${key} has a Policy fixture`).toBeDefined();
      const fixtureCounts = [...policyFixture.matchAll(/Days since most recent charge: (\d+)/g)].map((m) => Number(m[1]));
      for (const n of fixtureCounts) expect(n, `${key}: fixture claims ${n}`).toBe(derived);
    },
  );

  it("legitimate-refund is 5 days (inside the 14-day window), prohibited-refund is 21 and out-of-window-refund is 45, wherever the anchor sits", () => {
    const byKey = Object.fromEntries(SCENARIOS.map((s) => [s.key, derivedDayCount(s)]));
    expect(byKey["legitimate-refund"]).toBe(5);
    expect(byKey["prohibited-refund"]).toBe(21);
    expect(byKey["out-of-window-refund"]).toBe(45);
  });
});
