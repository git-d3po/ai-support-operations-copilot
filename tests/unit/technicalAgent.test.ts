import { afterEach, describe, expect, it } from "vitest";
import { technicalAgent } from "@/lib/orchestrator/agents/technicalAgent";
import { _resetProvidersForTests, registerProvider } from "@/lib/ai/providers/registry";
import { createTaskMockProvider } from "./testSupport/taskMockProvider";
import { makeAgentContext } from "./testSupport/fixtures";
import { AGENT_SUMMARY_MAX_CHARS } from "@/lib/ai/schemas";

afterEach(() => {
  _resetProvidersForTests();
});

describe("technicalAgent", () => {
  it("returns a known-issue-with-workaround finding", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        technical_agent_finding: JSON.stringify({
          agentKey: "technical",
          summary: "Matches the known large-board automation timeout issue (ENG-4821).",
          evidence: ["Board has ~2,500 cards, matches documented threshold"],
          confidence: 0.85,
          policyReferences: [],
          flags: ["known_issue_workaround_available"],
        }),
      }),
    );

    const result = await technicalAgent.run(makeAgentContext());
    expect(result.finding.flags).toContain("known_issue_workaround_available");
  });

  it("returns requires_escalation when the workaround already failed", async () => {
    registerProvider(
      "anthropic",
      createTaskMockProvider({
        technical_agent_finding: JSON.stringify({
          agentKey: "technical",
          summary: "Workaround already attempted and failed; needs engineering.",
          evidence: ["Customer confirmed board was already split"],
          confidence: 0.8,
          policyReferences: [],
          flags: ["known_issue_workaround_already_tried", "requires_escalation"],
        }),
      }),
    );

    const result = await technicalAgent.run(makeAgentContext());
    expect(result.finding.flags).toContain("requires_escalation");
  });

  it("falls back to a degraded finding on malformed output", async () => {
    registerProvider("anthropic", createTaskMockProvider({ technical_agent_finding: "nope" }));
    const result = await technicalAgent.run(makeAgentContext());
    expect(result.finding.flags).toContain("agent_failed");
    expect(result.finding.confidence).toBe(0);
  });

  // Regression for the first full live evaluation: the real model wrote
  // summaries over the schema's 400-char cap on both attempts (password-reset,
  // multi-domain), which failed the step and wrongly escalated a routine
  // password reset. The prompt never stated the limit.
  describe("summary length contract", () => {
    const finding = (summary: string) =>
      JSON.stringify({
        agentKey: "technical",
        summary,
        evidence: ["Standard self-service reset flow"],
        confidence: 0.9,
        policyReferences: [],
        flags: ["auto_resolvable"],
      });

    it("keeps the schema limit at 400 and states exactly that limit in the prompt", async () => {
      expect(AGENT_SUMMARY_MAX_CHARS).toBe(400);

      const systems: string[] = [];
      registerProvider(
        "anthropic",
        createTaskMockProvider({
          technical_agent_finding: (request) => {
            systems.push(request.system ?? "");
            return finding("Standard password reset flow; no account-specific issue.");
          },
        }),
      );
      await technicalAgent.run(makeAgentContext());

      expect(systems[0]).toContain(`"summary" MUST be ${AGENT_SUMMARY_MAX_CHARS} characters or fewer`);
      expect(systems[0]).toMatch(/concise and factual/);
      expect(systems[0]).toMatch(/at most 400 characters/);
    });

    it("states the limit on the retry attempt too, and recovers when the retry complies", async () => {
      const requests: { system: string; user: string }[] = [];
      const record = (text: string) => (request: { system?: string; messages: { content: string }[] }) => {
        requests.push({ system: request.system ?? "", user: request.messages.at(-1)!.content });
        return text;
      };
      registerProvider(
        "anthropic",
        createTaskMockProvider({
          technical_agent_finding: [
            record(finding("x".repeat(AGENT_SUMMARY_MAX_CHARS + 1))),
            record(finding("Standard password reset flow; no account-specific issue.")),
          ],
        }),
      );

      const result = await technicalAgent.run(makeAgentContext());

      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.system).toContain(`"summary" MUST be ${AGENT_SUMMARY_MAX_CHARS} characters or fewer`);
      }
      // The existing retry feedback (the specific validation error) still reaches the retry.
      expect(requests[1].user).toContain("Too big");
      expect(result.finding.flags).not.toContain("agent_failed");
      expect(result.finding.summary.length).toBeLessThanOrEqual(AGENT_SUMMARY_MAX_CHARS);
    });

    it("does not truncate: a summary that stays over the limit still fails honestly", async () => {
      registerProvider(
        "anthropic",
        createTaskMockProvider({
          technical_agent_finding: finding("y".repeat(AGENT_SUMMARY_MAX_CHARS + 50)),
        }),
      );

      const result = await technicalAgent.run(makeAgentContext());

      expect(result.finding.flags).toContain("agent_failed");
      expect(result.finding.confidence).toBe(0);
      expect(result.finding.summary).not.toContain("yyyyyyyyyy");
    });
  });
});
