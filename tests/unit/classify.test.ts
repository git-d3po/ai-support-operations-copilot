import { afterEach, describe, expect, it } from "vitest";
import { classifyTicket } from "@/lib/orchestrator/classify";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";

afterEach(() => {
  _resetProvidersForTests();
});

describe("classifyTicket", () => {
  it("returns a validated classification from a well-formed model response", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        ticket_classification: JSON.stringify({
          intent: "duplicate_charge",
          domains: ["billing", "policy"],
          sentiment: "frustrated",
          confidence: 0.9,
          summary: "Customer reports being charged twice.",
          keyEvidence: ["charged twice", "same amount"],
        }),
      }),
    );

    const result = await classifyTicket({
      ticketSummary: "Charged twice",
      conversation: [{ author: "customer", body: "I was charged twice this month." }],
    });

    expect(result.failed).toBe(false);
    expect(result.classification.intent).toBe("duplicate_charge");
    expect(result.classification.domains).toEqual(["billing", "policy"]);
    expect(result.metrics.inputTokens).toBeGreaterThan(0);
  });

  it("retries once on malformed output and succeeds on the second attempt", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        ticket_classification: [
          "this is not json",
          JSON.stringify({
            intent: "general_inquiry",
            domains: [],
            sentiment: "neutral",
            confidence: 0.5,
            summary: "ok",
            keyEvidence: [],
          }),
        ],
      }),
    );

    const result = await classifyTicket({ ticketSummary: "x", conversation: [] });

    expect(result.failed).toBe(false);
    expect(result.classification.intent).toBe("general_inquiry");
    // Two calls were made (one malformed, one valid) — both billed.
    expect(result.metrics.inputTokens).toBe(20);
  });

  it("falls back to a safe, honest placeholder when every attempt fails", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({ ticket_classification: "still not json" }),
    );

    const result = await classifyTicket({ ticketSummary: "x", conversation: [] });

    expect(result.failed).toBe(true);
    expect(result.classification.confidence).toBe(0);
    expect(result.classification.intent).toBe("general_inquiry");
    expect(result.classification.domains).toEqual([]);
  });

  it("rejects a response with an invalid intent value", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        ticket_classification: JSON.stringify({
          intent: "not_a_real_intent",
          domains: [],
          sentiment: "neutral",
          confidence: 0.5,
          summary: "x",
          keyEvidence: [],
        }),
      }),
    );

    const result = await classifyTicket({ ticketSummary: "x", conversation: [] });
    expect(result.failed).toBe(true);
  });
});
