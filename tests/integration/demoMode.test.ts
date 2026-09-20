import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Public Demo Mode against the real database (and the real orchestrator,
 * persistence and provenance): the curated-only gate, idempotent replay,
 * simulated provenance including for failures, and that live behavior is
 * untouched. The Anthropic SDK is mocked so that a regression could never make
 * a real call; no real credential is ever used here.
 */
const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: createMock } };
  }),
}));

import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { _resetProvidersForTests } from "@/lib/ai/providers/registry";
import { analyzeTicket } from "@/lib/orchestrator/analyzeTicket";
import { persistFailedRun } from "@/lib/orchestrator/persist";
import { DEMO_CURATED_ONLY_MESSAGE, requestAnalysis } from "@/lib/orchestrator/requestAnalysis";

const originalMode = process.env.AI_MODE;
const originalKey = process.env.ANTHROPIC_API_KEY;

let throwawayCustomerIds: string[] = [];
let throwawayTicketIds: string[] = [];
let touchedTicketIds: string[] = [];
let restoreSubjects: Array<() => Promise<unknown>> = [];

/**
 * Makes a curated ticket's demo run FAIL, using no code or recording change: the demo provider
 * recognizes a ticket by its subject line, so a ticket renamed to something it has no recording
 * for passes the curated gate (the gate uses the scenario key) and then aborts in the pipeline.
 * The subject is always restored in afterEach.
 */
async function makeDemoRunFail(ticketId: string, originalSubject: string) {
  await db.ticket.update({ where: { id: ticketId }, data: { subject: "Renamed so that no demo recording matches" } });
  restoreSubjects.push(() => db.ticket.update({ where: { id: ticketId }, data: { subject: originalSubject } }));
}
const restoreSubject = (ticketId: string, originalSubject: string) => db.ticket.update({ where: { id: ticketId }, data: { subject: originalSubject } });

async function curatedTicket(scenarioKey: string) {
  const ticket = await db.ticket.findFirstOrThrow({ where: { scenarioKey } });
  touchedTicketIds.push(ticket.id);
  return ticket;
}

async function createUncuratedTicket() {
  const customer = await db.customer.create({
    data: {
      name: "Demo Gate Test Customer",
      email: `demo-gate-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      company: "Test Co",
      timezone: "UTC",
      locale: "en-US",
    },
  });
  const ticket = await db.ticket.create({
    data: { customerId: customer.id, subject: "An ordinary background ticket", channel: "email", status: "open", priority: "low" },
  });
  throwawayCustomerIds.push(customer.id);
  throwawayTicketIds.push(ticket.id);
  touchedTicketIds.push(ticket.id);
  return ticket;
}

async function deleteRunsFor(ticketIds: string[]) {
  await db.agentInvocation.deleteMany({ where: { orchestrationRun: { ticketId: { in: ticketIds } } } });
  await db.orchestrationRun.deleteMany({ where: { ticketId: { in: ticketIds } } });
}

const runsFor = (ticketId: string) => db.orchestrationRun.count({ where: { ticketId } });

beforeEach(async () => {
  createMock.mockReset();
  vi.mocked(Anthropic).mockClear();
  _resetProvidersForTests();
  process.env.AI_MODE = "demo";
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(async () => {
  for (const restore of restoreSubjects) await restore();
  restoreSubjects = [];
  await deleteRunsFor(touchedTicketIds);
  await db.message.deleteMany({ where: { ticketId: { in: throwawayTicketIds } } });
  await db.ticket.deleteMany({ where: { id: { in: throwawayTicketIds } } });
  await db.customer.deleteMany({ where: { id: { in: throwawayCustomerIds } } });
  throwawayCustomerIds = [];
  throwawayTicketIds = [];
  touchedTicketIds = [];
  if (originalMode === undefined) delete process.env.AI_MODE;
  else process.env.AI_MODE = originalMode;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
  _resetProvidersForTests();
});

describe("a curated ticket runs in Demo Mode with no API key", () => {
  it("persists one completed run, marked simulated, with every step served by the demo provider", async () => {
    const ticket = await curatedTicket("duplicate-billing");
    await deleteRunsFor([ticket.id]);

    const result = await requestAnalysis(ticket.id);

    expect(result).toMatchObject({ ok: true, replayed: false });
    const run = await db.orchestrationRun.findUniqueOrThrow({
      where: { id: (result as { runId: string }).runId },
      include: { agentInvocations: true },
    });
    expect(run.status).toBe("completed");
    expect(run.isSimulated).toBe(true);
    expect(run.agentInvocations.map((i) => i.agentKey).sort()).toEqual(["billing", "classifier", "policy", "response"]);
    expect(run.agentInvocations.every((i) => i.provider === "demo")).toBe(true);
    expect(run.agentInvocations.every((i) => i.status === "succeeded")).toBe(true);
    expect(vi.mocked(Anthropic)).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("makes zero Anthropic calls even when an API key is present", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-present-but-must-be-ignored";
    const ticket = await curatedTicket("suspicious-activity");
    await deleteRunsFor([ticket.id]);

    const result = await requestAnalysis(ticket.id);

    expect(result.ok).toBe(true);
    expect(vi.mocked(Anthropic)).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("replay is idempotent: at most one demo run per ticket", () => {
  it("returns the existing run on repeat requests and creates no new rows", async () => {
    const ticket = await curatedTicket("duplicate-billing");
    await deleteRunsFor([ticket.id]);

    const first = await requestAnalysis(ticket.id);
    const invocationsAfterFirst = await db.agentInvocation.count({ where: { orchestrationRun: { ticketId: ticket.id } } });
    const second = await requestAnalysis(ticket.id);
    const third = await requestAnalysis(ticket.id);

    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toMatchObject({ ok: true, replayed: true });
    expect(third).toMatchObject({ ok: true, replayed: true });
    expect((second as { runId: string }).runId).toBe((first as { runId: string }).runId);
    expect((third as { runId: string }).runId).toBe((first as { runId: string }).runId);
    expect(await runsFor(ticket.id)).toBe(1);
    expect(await db.agentInvocation.count({ where: { orchestrationRun: { ticketId: ticket.id } } })).toBe(invocationsAfterFirst);
  });

  it("does not create a second run when requests arrive concurrently", async () => {
    const ticket = await curatedTicket("duplicate-billing");
    await deleteRunsFor([ticket.id]);

    const results = await Promise.all(Array.from({ length: 6 }, () => requestAnalysis(ticket.id)));

    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => (r as { runId: string }).runId)).size).toBe(1);
    expect(await runsFor(ticket.id)).toBe(1);
  });

  it("does not treat a non-demo simulated run (a test or dry-run fixture) as the demo run", async () => {
    const ticket = await curatedTicket("duplicate-billing");
    await deleteRunsFor([ticket.id]);
    const fixtureRun = await db.orchestrationRun.create({
      data: { ticketId: ticket.id, status: "completed", isSimulated: true, finishedAt: new Date() },
    });
    await db.agentInvocation.create({
      data: { orchestrationRunId: fixtureRun.id, agentKey: "classifier", status: "succeeded", model: "m", provider: "mock" },
    });

    const result = await requestAnalysis(ticket.id);

    expect(result).toMatchObject({ ok: true, replayed: false });
    expect((result as { runId: string }).runId).not.toBe(fixtureRun.id);
    expect(await runsFor(ticket.id)).toBe(2);
  });
});

describe("a failed demo run is recorded once and is not retried", () => {
  it("creates one failed, simulated run on the first request, and none on later requests", async () => {
    const ticket = await curatedTicket("duplicate-billing");
    await deleteRunsFor([ticket.id]);
    await makeDemoRunFail(ticket.id, ticket.subject);

    const first = await requestAnalysis(ticket.id);
    expect(first.ok).toBe(false);
    expect((first as { error: string }).error).toMatch(/curated evaluation scenarios only/);
    expect(await runsFor(ticket.id)).toBe(1);

    const run = await db.orchestrationRun.findFirstOrThrow({ where: { ticketId: ticket.id }, include: { agentInvocations: true } });
    expect(run.status).toBe("failed");
    expect(run.isSimulated).toBe(true); // a demo failure is never a real failure
    expect(run.agentInvocations).toHaveLength(0);

    const second = await requestAnalysis(ticket.id);
    const third = await requestAnalysis(ticket.id);
    expect(second).toEqual({ ok: false, error: run.errorMessage });
    expect(third).toEqual({ ok: false, error: run.errorMessage });
    expect(await runsFor(ticket.id)).toBe(1); // no new row, however many times it is asked
  });

  it("does not create a second run when requests arrive concurrently for a failing ticket", async () => {
    const ticket = await curatedTicket("duplicate-billing");
    await deleteRunsFor([ticket.id]);
    await makeDemoRunFail(ticket.id, ticket.subject);

    const results = await Promise.all(Array.from({ length: 6 }, () => requestAnalysis(ticket.id)));

    expect(results.every((r) => !r.ok)).toBe(true);
    expect(await runsFor(ticket.id)).toBe(1);
    const run = await db.orchestrationRun.findFirstOrThrow({ where: { ticketId: ticket.id } });
    expect(run.status).toBe("failed");
    expect(run.isSimulated).toBe(true);
  });

  it("does not retry even once the cause is gone (a failed demo run is deliberate and permanent until reseed)", async () => {
    const ticket = await curatedTicket("duplicate-billing");
    await deleteRunsFor([ticket.id]);
    await makeDemoRunFail(ticket.id, ticket.subject);
    expect((await requestAnalysis(ticket.id)).ok).toBe(false);

    await restoreSubject(ticket.id, ticket.subject); // the recording would now match again
    const again = await requestAnalysis(ticket.id);

    expect(again.ok).toBe(false);
    expect(await runsFor(ticket.id)).toBe(1);
  });

  it("still lets a different curated ticket run normally (a failure is per ticket)", async () => {
    const broken = await curatedTicket("duplicate-billing");
    const healthy = await curatedTicket("password-reset");
    await deleteRunsFor([broken.id, healthy.id]);
    await makeDemoRunFail(broken.id, broken.subject);

    expect((await requestAnalysis(broken.id)).ok).toBe(false);
    const ok = await requestAnalysis(healthy.id);

    expect(ok).toMatchObject({ ok: true, replayed: false });
    expect(await runsFor(broken.id)).toBe(1);
    expect(await runsFor(healthy.id)).toBe(1);
  });
});

describe("an ineligible ticket cannot create a run", () => {
  it("rejects an uncurated ticket before any persistence", async () => {
    const ticket = await createUncuratedTicket();
    const totalBefore = await db.orchestrationRun.count();

    const result = await requestAnalysis(ticket.id);

    expect(result).toEqual({ ok: false, error: DEMO_CURATED_ONLY_MESSAGE });
    expect(await runsFor(ticket.id)).toBe(0);
    expect(await db.orchestrationRun.count()).toBe(totalBefore);
  });

  it("rejects a ticket that does not exist, and malformed ids, with nothing persisted", async () => {
    const totalBefore = await db.orchestrationRun.count();

    expect(await requestAnalysis("does-not-exist")).toEqual({ ok: false, error: "Ticket not found." });
    for (const bad of ["", "x".repeat(65), null, undefined, 123, {}, ["a"]]) {
      expect(await requestAnalysis(bad)).toEqual({ ok: false, error: "Invalid ticket identifier." });
    }

    expect(await db.orchestrationRun.count()).toBe(totalBefore);
  });

  it("refuses an invalid AI_MODE rather than falling back to live", async () => {
    process.env.AI_MODE = "Demo";
    const ticket = await curatedTicket("duplicate-billing");
    await deleteRunsFor([ticket.id]);

    const result = await requestAnalysis(ticket.id);

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toMatch(/Invalid AI_MODE/);
    expect(await runsFor(ticket.id)).toBe(0);
    expect(vi.mocked(Anthropic)).not.toHaveBeenCalled();
  });
});

describe("a failed demo run is still simulated", () => {
  it("marks a run that aborted in demo mode as simulated, so it never counts as a real failure", async () => {
    // Bypass the curated gate on purpose (call analyzeTicket directly): the demo provider has no
    // recording for this ticket, so the pipeline aborts and a failed run is persisted.
    const ticket = await createUncuratedTicket();

    const result = await analyzeTicket(ticket.id);

    expect(result.ok).toBe(false);
    expect(result.run).not.toBeNull();
    const run = await db.orchestrationRun.findUniqueOrThrow({ where: { id: result.run!.orchestrationRunId } });
    expect(run.status).toBe("failed");
    expect(run.isSimulated).toBe(true);
    expect(result.run!.isSimulated).toBe(true);
    expect(run.errorMessage).toMatch(/curated evaluation scenarios only/);
  });

  it("derives failed-run provenance from the serving provider, and accepts an explicit override", async () => {
    const ticket = await createUncuratedTicket();

    const derived = await persistFailedRun(ticket.id, "aborted in demo mode");
    expect(derived.isSimulated).toBe(true);

    delete process.env.AI_MODE; // live: the real provider would have served it
    _resetProvidersForTests();
    const live = await persistFailedRun(ticket.id, "aborted in live mode");
    expect(live.isSimulated).toBe(false);

    const forced = await persistFailedRun(ticket.id, "explicit", true);
    expect(forced.isSimulated).toBe(true);

    const rows = await db.orchestrationRun.findMany({ where: { ticketId: ticket.id }, orderBy: { startedAt: "asc" } });
    expect(rows.map((r) => r.isSimulated)).toEqual([true, false, true]);
  });
});

describe("live mode is untouched", () => {
  it("still uses the real provider path: with no key it fails on the missing key, as a real (non-simulated) failure", async () => {
    // Never run this with a real key: an automated test must not spend a real credential.
    expect(originalKey ?? "").toBe("");
    delete process.env.AI_MODE;
    const ticket = await curatedTicket("duplicate-billing");
    await deleteRunsFor([ticket.id]);

    const result = await requestAnalysis(ticket.id);

    expect(result.ok).toBe(false);
    expect((result as { error: string }).error).toContain("ANTHROPIC_API_KEY");
    const run = await db.orchestrationRun.findFirstOrThrow({ where: { ticketId: ticket.id } });
    expect(run.status).toBe("failed");
    expect(run.isSimulated).toBe(false);
    expect(await db.agentInvocation.count({ where: { orchestrationRunId: run.id } })).toBe(0);
  });
});
