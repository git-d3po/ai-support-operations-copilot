import { describe, expect, it } from "vitest";
import { describeSimulatedRuns, operationsDataState } from "@/lib/operationsState";

/**
 * Which state AI Operations explains (src/lib/operationsState.ts). Pure: no runs
 * are created. The E2E suite runs in Demo Mode only, so the live-mode states are
 * covered here.
 */
describe("operationsDataState", () => {
  it("state A: Demo Mode with no real-model runs is explained as empty by design", () => {
    expect(operationsDataState("demo", 0)).toBe("demo-no-real-runs");
  });

  it("state B: real-model runs are shown as activity in either mode, with no Demo Mode explanation", () => {
    expect(operationsDataState("live", 3)).toBe("has-real-runs");
    expect(operationsDataState("demo", 3)).toBe("has-real-runs");
  });

  it("state C: live mode with nothing run yet does not blame Demo Mode", () => {
    expect(operationsDataState("live", 0)).toBe("no-real-runs");
  });
});

describe("describeSimulatedRuns", () => {
  it("agrees in number", () => {
    expect(describeSimulatedRuns(1)).toBe("1 simulated run is");
    expect(describeSimulatedRuns(2)).toBe("2 simulated runs are");
  });
});
