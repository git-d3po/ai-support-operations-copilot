import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { persistFailedRun, persistOrchestrationRun } from "@/lib/orchestrator/persist";
import type { OrchestrationOutcome } from "@/lib/orchestrator/orchestrator";

/**
 * Exercises persistence against the real local SQLite database (via the
 * same Prisma client the app uses) — not mocked. Every test creates its
 * own throwaway Customer/Ticket and deletes everything it created
 * afterward, so this never disturbs the seeded demo dataset.
 */

let ticketIds: string[] = [];
let customerIds: string[] = [];

afterEach(async () => {
  await db.evaluationResult.deleteMany({ where: {} }).catch(() => {});
  await db.agentInvocation.deleteMany({
    where: { orchestrationRun: { ticketId: { in: ticketIds } } },
  });
  await db.orchestrationRun.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await db.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  await db.customer.deleteMany({ where: { id: { in: customerIds } } });
  ticketIds = [];
  customerIds = [];
});

async function createThrowawayTicket() {
  const customer = await db.customer.create({
    data: {
      name: "Integration Test Customer",
      email: `integration-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      company: "Test Co",
      timezone: "UTC",
      locale: "en-US",
    },
  });
  const ticket = await db.ticket.create({
    data: {
      customerId: customer.id,
      subject: "Integration test ticket",
      channel: "email",
      status: "open",
      priority: "medium",
    },
  });
  customerIds.push(customer.id);
  ticketIds.push(ticket.id);
  return ticket;
}

function fabricateOutcome(): OrchestrationOutcome {
  return {
    classification: {
      intent: "duplicate_charge",
      domains: ["billing", "policy"],
      sentiment: "frustrated",
      confidence: 0.9,
      summary: "Duplicate charge reported.",
      keyEvidence: ["charged twice"],
    },
    classificationFailed: false,
    classificationMetrics: { model: "mock-model", inputTokens: 100, outputTokens: 20, latencyMs: 250, estimatedCostUsd: 0.001 },
    agentsInvoked: ["billing", "policy", "response"],
    agentResults: [
      {
        finding: {
          agentKey: "billing",
          summary: "Confirmed duplicate charge.",
          evidence: ["two $399 charges"],
          confidence: 0.95,
          policyReferences: [],
          flags: ["duplicate_charge_confirmed"],
        },
        metrics: { model: "mock-model", inputTokens: 200, outputTokens: 40, latencyMs: 300, estimatedCostUsd: 0.002 },
      },
      {
        finding: {
          agentKey: "policy",
          summary: "Refund approved.",
          evidence: [],
          confidence: 0.95,
          policyReferences: [{ slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" }],
          flags: [],
          policyDecision: {
            applicablePolicy: { slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" },
            decision: "approve",
            justification: "Confirmed duplicate.",
            conditionsMet: [],
            conditionsUnmet: [],
          },
        },
        metrics: { model: "mock-model", inputTokens: 300, outputTokens: 50, latencyMs: 400, estimatedCostUsd: 0.003 },
      },
      {
        finding: {
          agentKey: "response",
          summary: "Drafted response.",
          evidence: [],
          confidence: 0.9,
          policyReferences: [],
          flags: [],
        },
        metrics: { model: "mock-model", inputTokens: 150, outputTokens: 60, latencyMs: 200, estimatedCostUsd: 0.0015 },
        response: { body: "We refunded the duplicate charge.", tone: "empathetic", nextSteps: [] },
      },
    ],
    resolution: {
      action: "refund_customer",
      summary: "Confirmed duplicate, refunding.",
      confidence: 0.95,
      requiresHumanReview: false,
    },
    escalation: null,
    response: { body: "We refunded the duplicate charge.", tone: "empathetic", nextSteps: [] },
  };
}

describe("persistOrchestrationRun (real SQLite database)", () => {
  it("creates an OrchestrationRun with the top-level structured outputs", async () => {
    const ticket = await createThrowawayTicket();
    const { orchestrationRunId } = await persistOrchestrationRun(ticket.id, fabricateOutcome());

    const run = await db.orchestrationRun.findUniqueOrThrow({ where: { id: orchestrationRunId } });
    expect(run.status).toBe("completed");
    expect(run.ticketId).toBe(ticket.id);
    expect((run.classification as { intent: string }).intent).toBe("duplicate_charge");
    expect((run.resolution as { action: string }).action).toBe("refund_customer");
    expect(run.escalation).toBeNull();
  });

  it("creates one AgentInvocation per agent plus one for the classifier", async () => {
    const ticket = await createThrowawayTicket();
    const { orchestrationRunId } = await persistOrchestrationRun(ticket.id, fabricateOutcome());

    const invocations = await db.agentInvocation.findMany({
      where: { orchestrationRunId },
      orderBy: { startedAt: "asc" },
    });

    const keys = invocations.map((i) => i.agentKey).sort();
    expect(keys).toEqual(["billing", "classifier", "policy", "response"].sort());
    expect(invocations.every((i) => i.status === "succeeded")).toBe(true);
    expect(invocations.every((i) => i.model === "mock-model")).toBe(true);
  });

  it("captures model, tokens, latency, and estimated cost per invocation", async () => {
    const ticket = await createThrowawayTicket();
    const { orchestrationRunId } = await persistOrchestrationRun(ticket.id, fabricateOutcome());

    const billing = await db.agentInvocation.findFirstOrThrow({
      where: { orchestrationRunId, agentKey: "billing" },
    });
    expect(billing.inputTokens).toBe(200);
    expect(billing.outputTokens).toBe(40);
    expect(billing.latencyMs).toBe(300);
    expect(billing.estimatedCostUsd).toBeCloseTo(0.002);
  });

  it("marks an agent's invocation as failed and records the error when it degraded", async () => {
    const ticket = await createThrowawayTicket();
    const outcome = fabricateOutcome();
    outcome.agentResults[0].finding = {
      agentKey: "billing",
      summary: "billing agent could not produce a valid result",
      evidence: [],
      confidence: 0,
      policyReferences: [],
      flags: ["agent_failed"],
    };

    const { orchestrationRunId } = await persistOrchestrationRun(ticket.id, outcome);
    const billing = await db.agentInvocation.findFirstOrThrow({
      where: { orchestrationRunId, agentKey: "billing" },
    });
    expect(billing.status).toBe("failed");
    expect(billing.errorMessage).toContain("could not produce a valid result");
  });

  it("persists a failed run with no agent invocations when the whole pipeline aborts", async () => {
    const ticket = await createThrowawayTicket();
    const { orchestrationRunId } = await persistFailedRun(ticket.id, "ANTHROPIC_API_KEY is not set.");

    const run = await db.orchestrationRun.findUniqueOrThrow({
      where: { id: orchestrationRunId },
      include: { agentInvocations: true },
    });
    expect(run.status).toBe("failed");
    expect(run.errorMessage).toContain("ANTHROPIC_API_KEY");
    expect(run.agentInvocations).toHaveLength(0);
  });
});
