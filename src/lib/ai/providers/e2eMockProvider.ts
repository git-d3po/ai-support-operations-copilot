import { MockProvider } from "./mock";
import type { CompletionRequest } from "./types";

/**
 * ONLY used in the Playwright e2e suite (selected by registry.ts's
 * createProvider() when USE_MOCK_MODEL_PROVIDER=true, which only
 * playwright.config.ts's webServer sets, and nowhere else). Never active
 * in `npm run dev` or a normal production deployment.
 *
 * Why this exists: the e2e suite is supposed to be CLAUDE.md's
 * deterministic regression layer (see DECISIONS.md, "Why native
 * browser/computer-use for exploration, Playwright for regression"), but
 * there's no ANTHROPIC_API_KEY available in this development environment
 * to make live model calls with — and even with one, live calls would make
 * the suite non-deterministic, slow, and billed per run, which is
 * incompatible with "runs the same way every time." This fixture lets the
 * e2e suite exercise the REAL orchestrator, REAL persistence, and REAL UI
 * rendering end to end, with only the model call itself replaced by a
 * canned, scenario-tuned response. See DECISIONS.md ("E2E coverage for the
 * AI analysis flow uses a fixture model provider").
 *
 * Content here is deliberately tuned to the "duplicate-billing" curated
 * ticket (see prisma/data/scenarios.ts) — the e2e test targets that one
 * ticket specifically. This is a test fixture, not a claim about model
 * correctness; model correctness is EVALUATION.md's job, run against a
 * real provider when a key is available.
 */
function respond(request: CompletionRequest): string {
  const task = request.system?.match(/^TASK: (\S+)/)?.[1];

  switch (task) {
    case "ticket_classification":
      return JSON.stringify({
        intent: "duplicate_charge",
        domains: ["billing", "policy"],
        sentiment: "frustrated",
        confidence: 0.92,
        summary: "Customer reports being charged twice for the same invoice.",
        keyEvidence: ["charged twice", "$399.00", "same day"],
      });
    case "billing_agent_finding":
      return JSON.stringify({
        agentKey: "billing",
        summary: "Confirmed two identical $399.00 charges on the same invoice within hours.",
        evidence: ["Two succeeded charges of $399.00 on the same invoice, ~10 hours apart"],
        confidence: 0.95,
        policyReferences: [],
        flags: ["duplicate_charge_confirmed"],
      });
    case "policy_agent_finding":
      return JSON.stringify({
        agentKey: "policy",
        summary: "Duplicate Charge Policy applies; the second charge qualifies for a full refund.",
        evidence: ["Same amount, same invoice, well within the 48-hour window"],
        confidence: 0.95,
        policyReferences: [{ slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" }],
        flags: [],
        policyDecision: {
          applicablePolicy: { slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" },
          decision: "approve",
          justification: "Two identical charges on the same invoice within 48 hours is a confirmed duplicate.",
          conditionsMet: ["same amount", "same invoice", "within 48 hours"],
          conditionsUnmet: [],
        },
      });
    case "response_agent_reply":
      return JSON.stringify({
        body: "Thanks for flagging this, Marcus. We found the duplicate $399.00 charge on your account and have refunded it in full — it should appear on your statement within 5-10 business days. Sorry for the inconvenience!",
        tone: "empathetic",
        nextSteps: ["Refund processed", "Appears in 5-10 business days"],
      });
    default:
      throw new Error(`e2eMockProvider: no fixture response for task "${task}"`);
  }
}

export function createE2EMockProvider(): MockProvider {
  return new MockProvider((request) => ({
    text: respond(request),
    inputTokens: 120,
    outputTokens: 60,
  }));
}
