import { afterEach, describe, expect, it } from "vitest";
import { AGENT_SUMMARY_MAX_CHARS, AgentFindingSchema, CustomerResponseSchema, TicketClassificationSchema } from "@/lib/ai/schemas";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { technicalAgent } from "@/lib/orchestrator/agents/technicalAgent";
import { retrieveRelevantProductDocs } from "@/lib/orchestrator/evidence";
import { resolveOutcome } from "@/lib/orchestrator/resolve";
import { PRODUCT_DOCS } from "../../prisma/data/productDocs";
import { SCENARIOS } from "../../prisma/data/scenarios";
import { FIXTURES } from "../../scripts/evaluationDryRunFixtures";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAccountContext, makeAgentContext, makeClassification } from "./testSupport/fixtures";

/**
 * password-reset is the canonical ROUTINE case: EVALUATION.md calls it the
 * "Standard case, no escalation", the Account Security Policy says password
 * resets are automatic unless the account has an open security flag, and the
 * Technical Agent's prompt uses a routine reset as its `auto_resolvable`
 * example. It is also the only scenario exercising `auto_resolve`.
 *
 * The ticket originally described a repeated reset-email delivery failure,
 * which contradicted that design; it was rewritten as a plain reset request
 * (see DECISIONS.md). These tests guard the design — routine ticket,
 * unchanged expectation, neutral grounding doc that surfaces through the real
 * retrieval — not the model's behavior, which only a live run measures.
 */
const DOC_SLUG = "password-reset-guide";
const scenario = SCENARIOS.find((s) => s.key === "password-reset")!;
const doc = PRODUCT_DOCS.find((d) => d.slug === DOC_SLUG);
const fixture = FIXTURES["password-reset"];
const ticketText = `${scenario.ticket.subject} ${scenario.messages.map((m) => m.body).join(" ")}`;

afterEach(() => {
  _resetProvidersForTests();
});

function ticketContext() {
  return makeAgentContext({
    ticketSummary: scenario.ticket.subject,
    conversation: scenario.messages.map((m) => ({ author: m.author, body: m.body })),
    classification: makeClassification({ intent: "password_reset", domains: ["technical"] }),
    accountContext: makeAccountContext({
      productDocs: PRODUCT_DOCS.map((d) => ({ slug: d.slug, title: d.title, product: d.product, body: d.body })),
    }),
  });
}

describe("password-reset scenario: a genuinely routine request", () => {
  it("is a plain forgotten-password request, with no delivery failure, defect, or security concern", () => {
    expect(scenario.messages).toHaveLength(1);
    expect(scenario.messages[0].author).toBe("customer");
    expect(ticketText).toMatch(/forgot my password/i);
    expect(ticketText).toMatch(/reset/i);
    // What made the original ticket inconsistent with "standard / no escalation":
    expect(ticketText).not.toMatch(/never (arrive|show)|not (arriv|receiv)|didn'?t (arrive|receive)|spam|three times|already tried|still (not|no)/i);
    expect(ticketText).not.toMatch(/error|bug|broken|outage|defect|suspicious|unauthori[sz]ed|hacked|compromis|unrecogni[sz]ed/i);
  });

  it("keeps the original design: technical + response, no policy, no escalation, auto_resolve", () => {
    expect(scenario.expectedOutcome).toEqual({
      expectedIntent: "password_reset",
      expectedAgents: ["technical", "response"],
      expectedPolicySlug: null,
      expectedEscalation: false,
      expectedAction: "auto_resolve",
      notes: "No security flags on the account; standard reset flow applies per Account Security Policy.",
    });
    expect(scenario.ticket.channel).toBe("email");
    expect(scenario.ticket.priority).toBe("medium");
    expect(scenario.account.riskScore).toBeLessThan(50);
  });

  it("is still the only scenario that expects auto_resolve (the branch it exists to cover)", () => {
    const autoResolveScenarios = SCENARIOS.filter((s) => s.expectedOutcome.expectedAction === "auto_resolve");
    expect(autoResolveScenarios.map((s) => s.key)).toEqual(["password-reset"]);
  });
});

describe("password-reset grounding document", () => {
  it("exists and states only the standard self-service flow", () => {
    expect(doc).toBeDefined();
    expect(doc!.title).toBe("Resetting Your Password");
    expect(doc!.body).toMatch(/self-service/i);
    expect(doc!.body).toMatch(/sign-in page/i);
    expect(doc!.body).toMatch(/verified/i);
  });

  it("is neutral: prescribes no escalation, defect, workaround, or timing (guards against re-encoding an outcome)", () => {
    expect(doc!.body).not.toMatch(/escalat|engineering|ENG-\d+|outage|known issue|workaround|spam|junk|filter/i);
    expect(doc!.body).not.toMatch(/\d+\s*(minutes?|hours?|seconds?)/i);
  });

  it("is ranked first by the real retrieval for this ticket, ahead of unrelated docs", () => {
    const retrieved = retrieveRelevantProductDocs(PRODUCT_DOCS as never, ticketText);
    expect(retrieved[0]?.slug).toBe(DOC_SLUG);
    // The only other doc that shares vocabulary (2FA "reset") must not outrank it.
    const twoFactor = retrieved.findIndex((d: { slug: string }) => d.slug === "security-2fa-setup");
    expect(twoFactor === -1 || twoFactor > 0).toBe(true);
  });
});

describe("password-reset pipeline pieces (fixtures, real agent, real resolveOutcome)", () => {
  it("the Technical Agent is shown the doc and can produce a valid, concise, grounded routine finding", async () => {
    const seen: string[] = [];
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        technical_agent_finding: (request) => {
          seen.push(request.messages.at(-1)!.content);
          return fixture.technical_agent_finding;
        },
      }),
    );

    const { finding } = await technicalAgent.run(ticketContext());

    expect(seen[0]).toContain("Resetting Your Password");
    expect(finding.flags).not.toContain("agent_failed");
    expect(finding.flags).toContain("auto_resolvable");
    expect(finding.flags).not.toContain("requires_escalation");
    expect(finding.evidence.join(" ")).toContain(DOC_SLUG);
    expect(finding.summary.length).toBeLessThanOrEqual(AGENT_SUMMARY_MAX_CHARS);
    expect(AgentFindingSchema.safeParse(finding).success).toBe(true);
  });

  it("resolveOutcome maps the routine finding to auto_resolve with no escalation and no human review", () => {
    const finding = AgentFindingSchema.parse(JSON.parse(fixture.technical_agent_finding));
    const { resolution, escalation } = resolveOutcome(makeClassification({ intent: "password_reset" }), false, [finding]);
    expect(resolution.action).toBe("auto_resolve");
    expect(resolution.requiresHumanReview).toBe(false);
    expect(escalation).toBeNull();
  });

  it("the classification fixture is valid and describes a forgotten password", () => {
    const classification = TicketClassificationSchema.parse(JSON.parse(fixture.ticket_classification));
    expect(classification.intent).toBe("password_reset");
    expect(classification.keyEvidence.join(" ")).toMatch(/forgot/i);
    expect(`${classification.summary} ${classification.keyEvidence.join(" ")}`).not.toMatch(/never|spam|three times|not receiv/i);
  });

  it("the response fixture is a valid routine reply: no escalation, no Engineering, no claim of a performed action", () => {
    const reply = CustomerResponseSchema.parse(JSON.parse(fixture.response_agent_reply));
    const text = `${reply.body} ${reply.nextSteps.join(" ")}`;
    expect(text).toMatch(/reset/i);
    expect(text).not.toMatch(/escalat|engineering|investigat/i);
    expect(text).not.toMatch(/\b(I've|I have|we've|we have|I|we)\s+(triggered|sent|resent|reset|issued)\b/i);
  });
});
