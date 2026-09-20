import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENT_REGISTRY } from "@/lib/orchestrator/agents/registry";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import type { CompletionRequest } from "@/lib/ai/providers/types";
import type { AgentKey } from "@/lib/ai/schemas";
import { MockProvider } from "@/lib/ai/providers/mock";
import { extractTask } from "./testSupport/taskMockProvider";
import { makeAccountContext, makeAgentContext, makeClassification } from "./testSupport/fixtures";

/**
 * Regression guard for the reference-time architecture (DECISIONS.md,
 * "Reference time: business-derived time facts come from persisted event
 * data"): an agent's prompt must be a function of its context alone, never of
 * the wall clock.
 *
 * This is behavioral rather than a source scan: every registered agent is run
 * on an identical context under two very different system clocks, and the
 * prompts it sends to the model must be byte-identical. Unlike grepping for
 * `new Date()`, it also catches a clock read hidden inside a helper, and it
 * needs no allowlist. Only `Date` is faked, so it is the one place this suite
 * touches JavaScript time — production code has no way to receive a clock, so
 * this is the only way to observe a dependence on one.
 */
afterEach(() => {
  vi.useRealTimers();
  _resetProvidersForTests();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const REQUESTED_AT = new Date("2019-03-20T12:00:00.000Z");

function context() {
  return makeAgentContext({
    classification: makeClassification({ intent: "refund_request", domains: ["billing", "policy", "technical"] }),
    accountContext: makeAccountContext({
      requestedAt: REQUESTED_AT,
      policies: [{ slug: "refund-policy", title: "Refund Policy", category: "refunds", body: "Within 14 days of a charge." }],
      invoices: [
        { number: "INV-1", status: "paid", amountCents: 29700, issuedAt: new Date(REQUESTED_AT.getTime() - 5 * DAY_MS), dueAt: new Date(REQUESTED_AT.getTime() - 5 * DAY_MS), paidAt: new Date(REQUESTED_AT.getTime() - 5 * DAY_MS) },
      ],
      transactions: [
        { type: "charge", status: "succeeded", amountCents: 29700, reason: null, occurredAt: new Date(REQUESTED_AT.getTime() - 5 * DAY_MS), invoiceNumber: "INV-1" },
      ],
    }),
    // Only the Response agent reads these; harmless for the others.
    resolution: { action: "escalate", summary: "test", confidence: 0.5, requiresHumanReview: true },
    escalation: null,
  });
}

/** Runs one agent and returns every prompt (system + user) it sent, in order. */
async function capturePrompts(key: AgentKey): Promise<string[]> {
  const seen: string[] = [];
  registerProvider(
    "anthropic",
    new MockProvider((request: CompletionRequest) => {
      seen.push(`TASK=${extractTask(request.system)}\n${request.system}\n---\n${request.messages.map((m) => m.content).join("\n")}`);
      return { text: "not json", inputTokens: 1, outputTokens: 1 };
    }),
  );
  await AGENT_REGISTRY[key].run(context());
  return seen;
}

describe("no agent prompt depends on the wall clock", () => {
  const keys = Object.keys(AGENT_REGISTRY) as AgentKey[];

  it("covers every registered agent (the guard cannot silently skip a new one)", () => {
    expect(keys.length).toBeGreaterThanOrEqual(5);
  });

  it.each(keys)("%s: identical prompts whether the clock reads 2020 or 2041", async (key) => {
    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const early = await capturePrompts(key);
    _resetProvidersForTests();

    vi.setSystemTime(new Date("2041-06-15T18:45:00.000Z"));
    const late = await capturePrompts(key);

    expect(early.length).toBeGreaterThan(0); // a vacuous pass would prove nothing
    expect(late).toEqual(early);
  });
});
