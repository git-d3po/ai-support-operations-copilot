import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetProvidersForTests, getProvider, registerProvider } from "@/lib/ai/providers/registry";
import { MockProvider } from "@/lib/ai/providers/mock";
import { anyProviderSimulated } from "@/lib/ai/providers/provenance";
import { scoreOutcome } from "@/lib/evaluation/score";
import { runOrchestration, type OrchestrationOutcome } from "@/lib/orchestrator/orchestrator";
import { DEMO_RECORDINGS, findDemoRecordingBySubject, hasDemoRecording } from "@/lib/demo/recordings";
import { POLICIES } from "../../prisma/data/policies";
import { PRODUCT_DOCS } from "../../prisma/data/productDocs";
import { SCENARIOS, type ScenarioSeed } from "../../prisma/data/scenarios";
import { TICKET_TEMPLATES } from "../../prisma/data/ticketTemplates";
import { FIXTURES, scenarioKeyForTicketSummary, taskForSystemPrompt } from "../../scripts/evaluationDryRunFixtures";
import { makeAccountContext } from "./testSupport/fixtures";

/**
 * The scripted recordings are the single source of truth for Demo Mode AND the
 * dry-run harness. These tests hold them to the scenarios: every curated
 * scenario has one, each is correct when run through the REAL orchestrator and
 * scorer (using the provider AI_MODE=demo selects, not a hand-wired one), and
 * the harness differs from them only by its one deliberate mutation.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const ANCHOR = new Date("2019-03-20T12:00:00.000Z");
const originalMode = process.env.AI_MODE;

beforeEach(() => {
  process.env.AI_MODE = "demo";
  _resetProvidersForTests();
});

afterEach(() => {
  if (originalMode === undefined) delete process.env.AI_MODE;
  else process.env.AI_MODE = originalMode;
  _resetProvidersForTests();
});

function contextFor(scenario: ScenarioSeed) {
  return {
    ticketId: `test-${scenario.key}`,
    ticketSummary: scenario.ticket.subject,
    conversation: scenario.messages.map((m) => ({ author: m.author, body: m.body })),
    accountContext: makeAccountContext({
      requestedAt: ANCHOR,
      account: scenario.account,
      policies: POLICIES.map((p) => ({ slug: p.slug, title: p.title, category: p.category, body: p.body })),
      productDocs: PRODUCT_DOCS.map((d) => ({ slug: d.slug, title: d.title, product: d.product, body: d.body })),
      invoices: scenario.invoices.map((inv, i) => ({
        number: `INV-${i}`,
        status: inv.status,
        amountCents: inv.amountCents,
        issuedAt: new Date(ANCHOR.getTime() - inv.issuedDaysAgo * DAY_MS),
        dueAt: new Date(ANCHOR.getTime() - inv.dueDaysAgo * DAY_MS),
        paidAt: inv.paidDaysAgo === undefined ? null : new Date(ANCHOR.getTime() - inv.paidDaysAgo * DAY_MS),
      })),
      transactions: scenario.transactions.map((t) => ({
        type: t.type,
        status: t.status,
        amountCents: t.amountCents,
        reason: t.reason ?? null,
        occurredAt: new Date(ANCHOR.getTime() - t.occurredDaysAgo * DAY_MS),
        invoiceNumber: t.invoiceIndex === undefined ? null : `INV-${t.invoiceIndex}`,
      })),
    }),
  };
}

/** The structured artifacts of a run, without the timings that legitimately vary. */
function stable(outcome: OrchestrationOutcome) {
  return {
    classification: outcome.classification,
    agentsInvoked: outcome.agentsInvoked,
    findings: outcome.agentResults.map((r) => r.finding),
    resolution: outcome.resolution,
    escalation: outcome.escalation,
    response: outcome.response,
  };
}

describe("recordings match the curated scenarios", () => {
  it("has exactly one recording per curated scenario, no more and no fewer", () => {
    expect(Object.keys(DEMO_RECORDINGS).sort()).toEqual(SCENARIOS.map((s) => s.key).sort());
    expect(SCENARIOS).toHaveLength(11);
  });

  it("keys each recording by the scenario's own ticket subject, and the subjects are unique", () => {
    for (const s of SCENARIOS) expect(DEMO_RECORDINGS[s.key].subject).toBe(s.ticket.subject);
    expect(new Set(Object.values(DEMO_RECORDINGS).map((r) => r.subject)).size).toBe(11);
  });

  it("never collides with a background ticket subject (background tickets must not be recognized)", () => {
    const backgroundSubjects = new Set(Object.values(TICKET_TEMPLATES).flatMap((templates) => templates.map((t) => t.subject)));
    for (const r of Object.values(DEMO_RECORDINGS)) expect(backgroundSubjects.has(r.subject)).toBe(false);
  });

  it("looks recordings up by scenario key and by subject, and only for curated scenarios", () => {
    expect(hasDemoRecording("suspicious-activity")).toBe(true);
    expect(hasDemoRecording("not-a-scenario")).toBe(false);
    expect(hasDemoRecording(null)).toBe(false);
    expect(hasDemoRecording(undefined)).toBe(false);
    expect(hasDemoRecording("__proto__")).toBe(false);
    expect(hasDemoRecording("toString")).toBe(false);
    expect(findDemoRecordingBySubject(" Charged twice this billing cycle ")?.scenarioKey).toBe("duplicate-billing");
    expect(findDemoRecordingBySubject("nope")).toBeNull();
  });
});

describe("all 11 curated scenarios through the real orchestrator with the provider AI_MODE=demo selects", () => {
  it("selects the demo provider (not Anthropic) in demo mode", () => {
    expect(getProvider("anthropic").key).toBe("demo");
  });

  it.each(SCENARIOS.map((s) => [s.key, s] as const))("%s: scores 1.00 against its expected outcome", async (_key, scenario) => {
    const outcome = await runOrchestration(contextFor(scenario));
    const scores = scoreOutcome(scenario.expectedOutcome, outcome);
    expect(scores).toMatchObject({
      classificationCorrect: true,
      routingCorrect: true,
      escalationCorrect: true,
      resolutionCorrect: true,
    });
    expect(scores.policyCorrect === null || scores.policyCorrect === true).toBe(true);
    expect(scores.overallScore).toBe(1);
    expect(outcome.agentsInvoked).toEqual(expect.arrayContaining(scenario.expectedOutcome.expectedAgents));
    expect(outcome.resolution.action).toBe(scenario.expectedOutcome.expectedAction);
    expect(outcome.classificationFailed).toBe(false);
    expect(outcome.agentResults.every((r) => !r.finding.flags.includes("agent_failed"))).toBe(true);
  });

  it.each(SCENARIOS.map((s) => [s.key, s] as const))("%s: every call is served by 'demo', so the run is simulated", async (_key, scenario) => {
    const outcome = await runOrchestration(contextFor(scenario));
    const providers = [outcome.classificationMetrics.provider, ...outcome.agentResults.map((r) => r.metrics.provider)];
    expect(new Set(providers)).toEqual(new Set(["demo"]));
    expect(anyProviderSimulated(providers)).toBe(true);
    expect(outcome.agentResults.every((r) => r.metrics.estimatedCostUsd === 0)).toBe(true);
  });

  it.each(SCENARIOS.map((s) => [s.key, s] as const))("%s: replaying gives an identical structured result", async (_key, scenario) => {
    const first = await runOrchestration(contextFor(scenario));
    _resetProvidersForTests();
    const second = await runOrchestration(contextFor(scenario));
    expect(JSON.stringify(stable(second))).toBe(JSON.stringify(stable(first)));
  });
});

describe("the dry-run harness derives from the recordings and adds only its deliberate mutation", () => {
  it("equals the recordings for every scenario except known-technical-issue", () => {
    for (const [key, recording] of Object.entries(DEMO_RECORDINGS)) {
      if (key === "known-technical-issue") continue;
      expect(FIXTURES[key], key).toEqual(recording.responses);
    }
    expect(Object.keys(FIXTURES).sort()).toEqual(Object.keys(DEMO_RECORDINGS).sort());
  });

  it("keeps the deliberately wrong known-technical-issue answer in the harness only, never in the production recordings", () => {
    const wrong = JSON.parse(FIXTURES["known-technical-issue"].ticket_classification);
    const correct = JSON.parse(DEMO_RECORDINGS["known-technical-issue"].responses.ticket_classification);
    expect(wrong.intent).toBe("billing_question");
    expect(correct.intent).toBe("technical_issue");
    expect(JSON.stringify(DEMO_RECORDINGS)).not.toMatch(/INTENTIONAL MISCLASSIFICATION|Deliberately incorrect/);
  });

  it("still makes the scorer fail the deliberate mutation through the real pipeline (its whole purpose)", async () => {
    _resetProvidersForTests();
    registerProvider(
      "anthropic",
      new MockProvider((request) => {
        const task = taskForSystemPrompt(request.system);
        const key = scenarioKeyForTicketSummary(request.messages.at(-1)?.content ?? "");
        const text = task && key ? FIXTURES[key]?.[task] : undefined;
        if (!text) throw new Error(`no fixture for ${task}/${key}`);
        return { text, inputTokens: 1, outputTokens: 1 };
      }),
    );
    const scenario = SCENARIOS.find((s) => s.key === "known-technical-issue")!;
    const scores = scoreOutcome(scenario.expectedOutcome, await runOrchestration(contextFor(scenario)));
    expect(scores.classificationCorrect).toBe(false);
    expect(scores.routingCorrect).toBe(false);
    expect(scores.resolutionCorrect).toBe(false);
    expect(scores.overallScore).toBeLessThan(0.85);
  });
});
