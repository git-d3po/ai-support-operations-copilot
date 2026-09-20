import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An unexpected database failure while handling a demo request must come back as
 * a FAILURE the button can show, never as a success and never as a thrown error
 * (which the button cannot handle). The database is mocked here, so this needs no
 * real database; the real-database behavior is covered in tests/integration/demoMode.test.ts.
 */
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), findFirst: vi.fn(), analyzeTicket: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: { ticket: { findUnique: mocks.findUnique }, orchestrationRun: { findFirst: mocks.findFirst } },
}));
vi.mock("@/lib/orchestrator/analyzeTicket", () => ({ analyzeTicket: mocks.analyzeTicket }));

import { DEMO_UNAVAILABLE_MESSAGE, requestAnalysis } from "@/lib/orchestrator/requestAnalysis";

const originalMode = process.env.AI_MODE;
const DB_ERROR = new Error("SQLITE_BUSY: database is locked at /private/path/dev.db");
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.findUnique.mockReset();
  mocks.findFirst.mockReset();
  mocks.analyzeTicket.mockReset();
  process.env.AI_MODE = "demo";
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  if (originalMode === undefined) delete process.env.AI_MODE;
  else process.env.AI_MODE = originalMode;
});

describe("demo request with a failing database", () => {
  it("returns a failure (not a success, not a throw) when the ticket lookup fails, and analyzes nothing", async () => {
    mocks.findUnique.mockRejectedValue(DB_ERROR);

    const result = await requestAnalysis("some-ticket-id");

    expect(result).toEqual({ ok: false, error: DEMO_UNAVAILABLE_MESSAGE });
    expect(mocks.analyzeTicket).not.toHaveBeenCalled();
  });

  it("returns a failure when the existing-run lookup fails, and analyzes nothing", async () => {
    mocks.findUnique.mockResolvedValue({ scenarioKey: "duplicate-billing" });
    mocks.findFirst.mockRejectedValue(DB_ERROR);

    const result = await requestAnalysis("some-ticket-id");

    expect(result).toEqual({ ok: false, error: DEMO_UNAVAILABLE_MESSAGE });
    expect(mocks.analyzeTicket).not.toHaveBeenCalled();
  });

  it("does not leak the underlying error to the visitor, but logs it for the operator", async () => {
    mocks.findUnique.mockRejectedValue(DB_ERROR);

    const result = await requestAnalysis("some-ticket-id");

    expect((result as { error: string }).error).not.toMatch(/SQLITE|private|dev\.db/);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toContain(DB_ERROR);
  });

  it("gives every concurrent caller a failure (none throws), and does not leave the ticket stuck in flight", async () => {
    mocks.findUnique.mockResolvedValue({ scenarioKey: "duplicate-billing" });
    mocks.findFirst.mockRejectedValue(DB_ERROR);

    const results = await Promise.all([1, 2, 3, 4].map(() => requestAnalysis("busy-ticket")));
    expect(results.every((r) => !r.ok && r.error === DEMO_UNAVAILABLE_MESSAGE)).toBe(true);

    // Once the database recovers, the same ticket proceeds normally: the failed attempt left no stale in-flight entry.
    mocks.findFirst.mockResolvedValue(null);
    mocks.analyzeTicket.mockResolvedValue({ ok: true, run: { orchestrationRunId: "run-1", isSimulated: true }, outcome: {} });
    const recovered = await requestAnalysis("busy-ticket");
    expect(recovered).toEqual({ ok: true, runId: "run-1", replayed: false });
    expect(mocks.analyzeTicket).toHaveBeenCalledTimes(1);
  });

  it("still rejects an uncurated ticket with the curated-only message, not the server-error message", async () => {
    mocks.findUnique.mockResolvedValue({ scenarioKey: null });

    const result = await requestAnalysis("background-ticket");

    expect(result).toEqual({ ok: false, error: "Demo Mode is available for the curated evaluation scenarios only." });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.analyzeTicket).not.toHaveBeenCalled();
  });
});

describe("live mode is unchanged by this handling", () => {
  it("goes straight to analyzeTicket and touches neither demo lookup", async () => {
    delete process.env.AI_MODE;
    mocks.analyzeTicket.mockResolvedValue({ ok: true, run: { orchestrationRunId: "live-run", isSimulated: false }, outcome: {} });

    const result = await requestAnalysis("any-ticket-id");

    expect(result).toEqual({ ok: true, runId: "live-run", replayed: false });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
