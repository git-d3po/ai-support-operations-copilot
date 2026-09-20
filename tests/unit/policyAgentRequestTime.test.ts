import { afterEach, describe, expect, it } from "vitest";
import { policyAgent } from "@/lib/orchestrator/agents/policyAgent";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAccountContext, makeAgentContext, makeClassification } from "./testSupport/fixtures";

/**
 * Refund timing is evaluated as of the customer's request time
 * (`TicketDataContext.requestedAt`, from `Ticket.createdAt`) — never the wall
 * clock. These tests drive the REAL Policy prompt path (real
 * `policyAgent.run`, real prompt construction) with a capturing mock provider,
 * and control time only through explicit context data, not fake timers. See
 * DECISIONS.md ("Reference time: business-derived time facts come from
 * persisted event data").
 */
afterEach(() => {
  _resetProvidersForTests();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const REFUND_POLICY = {
  slug: "refund-policy",
  title: "Refund Policy",
  category: "refunds",
  body: "Refunds are approved within 14 days of a charge with minimal usage.",
};

function charge(occurredAt: Date, overrides: Record<string, unknown> = {}) {
  return {
    type: "charge",
    status: "succeeded",
    amountCents: 29700,
    reason: null,
    occurredAt,
    invoiceNumber: null,
    ...overrides,
  };
}

/** Runs the real Policy agent and returns the user prompt it sent to the model. */
async function capturePolicyPrompt(requestedAt: Date, transactions: ReturnType<typeof charge>[]): Promise<string> {
  const seen: string[] = [];
  registerProvider(
    "anthropic",
    createTaskMockProvider({
      policy_agent_finding: (request) => {
        seen.push(request.messages.at(-1)!.content);
        return "not json"; // the prompt is what's under test, not the model's answer
      },
    }),
  );
  await policyAgent.run(
    makeAgentContext({
      classification: makeClassification({ intent: "refund_request", domains: ["billing", "policy"] }),
      accountContext: makeAccountContext({ policies: [REFUND_POLICY], transactions, requestedAt }),
    }),
  );
  expect(seen.length).toBeGreaterThan(0);
  return seen[0];
}

/** The value printed on the day-count line of the Policy prompt. */
function printedDayCount(prompt: string): string {
  const match = prompt.match(/^- Days from the most recent successful charge to the customer's request.*: (.+)$/m);
  if (!match) throw new Error(`Day-count line not found in prompt:\n${prompt}`);
  return match[1];
}

describe("Policy prompt: day count is measured to the customer's request time", () => {
  it("prints 5 for a charge exactly 5 days before a request made years ago, regardless of today's date", async () => {
    const requestedAt = new Date("2019-03-20T12:00:00.000Z");
    const prompt = await capturePolicyPrompt(requestedAt, [charge(new Date(requestedAt.getTime() - 5 * DAY_MS))]);
    expect(printedDayCount(prompt)).toBe("5");
  });

  it("states in the prompt that the count is relative to the request time, and names that time", async () => {
    const requestedAt = new Date("2019-03-20T12:00:00.000Z");
    const prompt = await capturePolicyPrompt(requestedAt, [charge(new Date(requestedAt.getTime() - 5 * DAY_MS))]);
    expect(prompt).toContain("customer's request");
    expect(prompt).toContain(requestedAt.toISOString());
  });

  it.each([
    [0, "0"],
    [13, "13"],
    [14, "14"],
    [15, "15"],
    [91, "91"],
  ])("prints %i days for a charge made %i days before the request", async (days, expected) => {
    const requestedAt = new Date("2024-06-10T09:30:00.000Z");
    const prompt = await capturePolicyPrompt(requestedAt, [charge(new Date(requestedAt.getTime() - days * DAY_MS))]);
    expect(printedDayCount(prompt)).toBe(expected);
  });

  it("uses the most recent charge AT OR BEFORE the request, ignoring one that occurred after it", async () => {
    const requestedAt = new Date("2024-06-10T09:30:00.000Z");
    const prompt = await capturePolicyPrompt(requestedAt, [
      charge(new Date(requestedAt.getTime() - 5 * DAY_MS)),
      charge(new Date(requestedAt.getTime() + 2 * DAY_MS)), // a later renewal: cannot be evidence for this request
    ]);
    expect(printedDayCount(prompt)).toBe("5");
  });

  it("counts a charge made at the exact request instant", async () => {
    const requestedAt = new Date("2024-06-10T09:30:00.000Z");
    const prompt = await capturePolicyPrompt(requestedAt, [charge(new Date(requestedAt.getTime()))]);
    expect(printedDayCount(prompt)).toBe("0");
  });

  it("prints n/a when every charge occurred after the request", async () => {
    const requestedAt = new Date("2024-06-10T09:30:00.000Z");
    const prompt = await capturePolicyPrompt(requestedAt, [charge(new Date(requestedAt.getTime() + 1 * DAY_MS))]);
    expect(printedDayCount(prompt)).toMatch(/^n\/a/);
  });

  it("prints n/a when there are no successful charges at all (existing behavior)", async () => {
    const requestedAt = new Date("2024-06-10T09:30:00.000Z");
    const prompt = await capturePolicyPrompt(requestedAt, [
      charge(new Date(requestedAt.getTime() - 3 * DAY_MS), { status: "failed" }),
    ]);
    expect(printedDayCount(prompt)).toMatch(/^n\/a/);
  });
});
