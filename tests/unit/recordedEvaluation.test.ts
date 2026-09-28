import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCENARIOS } from "../../prisma/data/scenarios";
import { RECORDED_LIVE_EVALUATION as record } from "@/lib/evaluation/recordedEvaluation";
import {
  deriveRecordedEvaluation,
  parseRecordedEvaluation,
  serializeRecordedEvaluation,
  type RecordedEvaluationSource,
} from "@/lib/evaluation/recordedEvaluationContract";

/**
 * The recorded 2026-09-24 live evaluation (src/lib/evaluation/recorded/) and
 * the derivation that produced it (DECISIONS.md, "Recorded live evaluation
 * shipped as a verified snapshot"). The source database is local and not in
 * the repository, so these check the committed record's own consistency and
 * its agreement with the current scenarios; `exportEvaluationSnapshot.ts
 * --check` is what compares it with its source.
 */
const SNAPSHOT_FILE = path.resolve(__dirname, "../../src/lib/evaluation/recorded/live-2026-09-24.json");

describe("the recorded 2026-09-24 live evaluation", () => {
  it("parses against its contract, at schema version 1, and is frozen", () => {
    expect(record.schemaVersion).toBe(1);
    expect(record.id).toBe("live-2026-09-24");
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.scenarios[0].scores)).toBe(true);
  });

  it("is committed in its canonical serialization (deterministic, so --check can compare bytes)", () => {
    const committed = readFileSync(SNAPSHOT_FILE, "utf8");
    expect(serializeRecordedEvaluation(parseRecordedEvaluation(JSON.parse(committed)))).toBe(committed);
  });

  it("covers exactly the current curated scenarios, with the subjects and expected outcomes they define", () => {
    expect(record.scenarios.map((s) => s.scenarioKey)).toEqual(SCENARIOS.map((s) => s.key).sort());
    for (const scenario of record.scenarios) {
      const definition = SCENARIOS.find((s) => s.key === scenario.scenarioKey)!;
      expect(scenario.ticketSubject, scenario.scenarioKey).toBe(definition.ticket.subject);
      expect(scenario.expected, scenario.scenarioKey).toEqual(definition.expectedOutcome);
    }
  });

  it("keeps every stored pass decision consistent with its score and the recorded threshold", () => {
    // The threshold in force at the evaluated commit (0.85), asserted as the historical fact it is, not
    // compared with today's PASS_THRESHOLD: a later change to that constant must not affect this record.
    expect(record.passThreshold).toBe(0.85);
    for (const scenario of record.scenarios) {
      expect(scenario.passed, scenario.scenarioKey).toBe(scenario.scores.overallScore >= record.passThreshold);
    }
  });

  it("has totals that agree with its scenario records and with the source run", () => {
    const { totals } = record;
    expect(totals.scenarios).toBe(11);
    expect(totals.passed).toBe(record.scenarios.filter((s) => s.passed).length);
    expect(totals.passed).toBe(11);
    // One step per agent that ran, plus the classifier, in every scenario.
    expect(totals.agentSteps).toBe(record.scenarios.reduce((sum, s) => sum + s.actual.agents.length + 1, 0));
    expect(totals.agentSteps).toBe(39);
    expect(totals.failedAgentSteps).toBe(record.scenarios.reduce((sum, s) => sum + s.failedAgents.length, 0));
    expect(totals.failedAgentSteps).toBe(1);
    // Source-derived (sums over the run's 39 AgentInvocation rows); not re-derivable from the per-scenario records.
    expect(totals.inputTokens).toBe(36465);
    expect(totals.outputTokens).toBe(14295);
    expect(totals.estimatedCostUsd).toBe(0.21283);
  });

  it("records the historical run as it happened, including the four imperfect passes", () => {
    const byKey = new Map(record.scenarios.map((s) => [s.scenarioKey, s]));
    const prohibited = byKey.get("prohibited-refund")!;
    expect(prohibited.scores.overallScore).toBeCloseTo(0.941, 3);
    expect(prohibited.failedAgents).toEqual(["billing"]);
    expect(prohibited.actual.action).toBe("deny_request");
    expect(prohibited.passed).toBe(true);
    expect(byKey.get("multi-domain")!.scores.classificationCorrect).toBe(false);
    expect(byKey.get("multi-domain")!.scores.overallScore).toBeCloseTo(0.882, 3);
    expect(byKey.get("failed-payment")!.scores.routingCorrect).toBe(false);
    expect(byKey.get("failed-payment")!.scores.overallScore).toBeCloseTo(0.857, 3);
    expect(byKey.get("technical-escalation")!.scores.routingCorrect).toBe(false);
    expect(byKey.get("technical-escalation")!.scores.overallScore).toBeCloseTo(0.857, 3);
  });

  it("carries its provenance: the date, the evaluated commit, the source checksum and a real provider only", () => {
    expect(record.recordedAt.start.startsWith("2026-09-24T")).toBe(true);
    expect(record.recordedAt.end.startsWith("2026-09-24T")).toBe(true);
    expect(Date.parse(record.recordedAt.start)).toBeLessThan(Date.parse(record.recordedAt.end));
    expect(record.codeCommit).toBe("0a12bb9");
    expect(record.source).toEqual({
      database: "eval-2026-09-24.db",
      sha256: "fe390b73aa58eb580b3711288a424911ad8bbdf7fac46bbc9501a94e73e5d19f",
      records: "EvaluationResult",
    });
    expect(new Set(record.routing.map((r) => r.provider))).toEqual(new Set(["anthropic"]));
    expect(new Set(record.routing.map((r) => r.step)).size).toBe(record.routing.length);
  });

  it("identifies each scenario's source result uniquely", () => {
    const ids = record.scenarios.map((s) => s.sourceResultId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains no customer data, raw errors, paths or secrets, and its contract rejects any extra field", () => {
    const raw = readFileSync(SNAPSHOT_FILE, "utf8");
    for (const scenario of SCENARIOS) {
      expect(raw).not.toContain(scenario.customer.email);
      expect(raw).not.toContain(scenario.customer.name);
      expect(raw).not.toContain(scenario.customer.company);
      expect(raw).not.toContain(scenario.customer.email.split("@")[1]);
    }
    for (const forbidden of ["@", "/Users/", "/home/", "/private/", ":\\\\", "sk-ant", "errorMessage", "Invalid input", "could not produce"]) {
      expect(raw, forbidden).not.toContain(forbidden);
    }
    const withExtra = JSON.parse(raw);
    withExtra.scenarios[0].customerEmail = "someone@example.com";
    expect(() => parseRecordedEvaluation(withExtra)).toThrow();
    const withSimulated = JSON.parse(raw);
    withSimulated.routing[0].provider = "demo";
    expect(() => parseRecordedEvaluation(withSimulated)).toThrow();
  });
});

describe("deriveRecordedEvaluation: what the exporter refuses", () => {
  const definition = SCENARIOS.find((s) => s.key === "password-reset")!;
  const provenance = { database: "eval-test.db", sha256: "0".repeat(64), codeCommit: "abcdef1", passThreshold: 0.85 };
  const scores = {
    classificationCorrect: true,
    routingCorrect: true,
    policyCorrect: null,
    escalationCorrect: true,
    resolutionCorrect: true,
    evidenceQuality: 1,
    overallScore: 1,
    notes: "All scored dimensions matched the expected outcome.",
  };
  const source = (): RecordedEvaluationSource => ({
    cases: [{ id: "case-1", scenarioKey: definition.key, ticketSubject: definition.ticket.subject, expectedOutcome: definition.expectedOutcome }],
    results: [
      { id: "result-1", evaluationCaseId: "case-1", orchestrationRunId: "run-1", scores, passed: true, isSimulated: false, createdAt: new Date("2026-01-02T03:04:05.000Z") },
    ],
    runs: [
      {
        id: "run-1",
        status: "completed",
        isSimulated: false,
        classification: { intent: "password_reset" },
        resolution: { action: "auto_resolve" },
        escalation: null,
      },
    ],
    invocations: [
      { orchestrationRunId: "run-1", agentKey: "response", status: "succeeded", finding: {}, model: "m-2", provider: "anthropic", inputTokens: 5, outputTokens: 6, estimatedCostUsd: 0.2 },
      { orchestrationRunId: "run-1", agentKey: "classifier", status: "succeeded", finding: {}, model: "m-1", provider: "anthropic", inputTokens: 1, outputTokens: 2, estimatedCostUsd: 0.1 },
      { orchestrationRunId: "run-1", agentKey: "technical", status: "succeeded", finding: {}, model: "m-2", provider: "anthropic", inputTokens: 3, outputTokens: 4, estimatedCostUsd: 0.1 },
    ],
  });
  const derive = (s: RecordedEvaluationSource) => deriveRecordedEvaluation(s, provenance, [definition]);

  it("derives a record in canonical order: agents and routing by pipeline order, cost without float noise", () => {
    const derived = derive(source());
    expect(derived.id).toBe("live-2026-01-02");
    expect(derived.scenarios[0].actual.agents).toEqual(["technical", "response"]);
    expect(derived.routing.map((r) => r.step)).toEqual(["classifier", "technical", "response"]);
    expect(derived.totals).toEqual({
      scenarios: 1,
      passed: 1,
      agentSteps: 3,
      failedAgentSteps: 0,
      inputTokens: 9,
      outputTokens: 12,
      estimatedCostUsd: 0.4,
    });
    // Deterministic: the same rows in another order give the same bytes.
    const shuffled = source();
    shuffled.invocations.reverse();
    expect(serializeRecordedEvaluation(derive(shuffled))).toBe(serializeRecordedEvaluation(derived));
  });

  const refusals: [string, (s: RecordedEvaluationSource) => void, RegExp][] = [
    ["a simulated result", (s) => (s.results[0].isSimulated = true), /simulated/],
    ["a step served by a non-real provider", (s) => (s.invocations[0].provider = "mock"), /not a real provider/],
    ["a run that did not complete", (s) => (s.runs[0].status = "failed"), /not "completed"/],
    ["two results for one scenario", (s) => s.results.push({ ...s.results[0], id: "result-2" }), /exactly one result/],
    ["a scenario set that differs from SCENARIOS", (s) => (s.cases[0].scenarioKey = "renamed"), /scenario set differs/],
    ["an expected outcome that differs from SCENARIOS", (s) => (s.cases[0].expectedOutcome = { ...definition.expectedOutcome, expectedAction: "escalate" }), /expected outcome differs/],
    ["a pass decision that disagrees with its score", (s) => (s.results[0].passed = false), /disagrees with score/],
  ];
  it.each(refusals)("refuses %s", (_name, mutate, message) => {
    const s = source();
    mutate(s);
    expect(() => derive(s)).toThrow(message);
  });
});
