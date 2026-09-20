import { describe, expect, it } from "vitest";
import { DemoProvider, DemoRecordingNotFoundError } from "@/lib/ai/providers/demoProvider";
import { DEMO_RECORDINGS } from "@/lib/demo/recordings";
import { isSimulatedProvider } from "@/lib/ai/providers/provenance";
import type { CompletionRequest } from "@/lib/ai/providers/types";
import { TicketClassificationSchema } from "@/lib/ai/schemas";

/** The request shape every pipeline step sends: a `TASK:` system line and a `Ticket:` user line. */
function request(task: string, subject: string, userSuffix = ""): CompletionRequest {
  return {
    model: "ignored-by-demo",
    system: `TASK: ${task}\nYou are a step.`,
    messages: [{ role: "user", content: `Ticket: ${subject}\n\nConversation:\n(text)${userSuffix}` }],
  };
}

const [DUP_KEY, DUP] = ["duplicate-billing", DEMO_RECORDINGS["duplicate-billing"]] as const;

describe("DemoProvider", () => {
  it("identifies itself as exactly 'demo', which provenance treats as simulated", () => {
    const provider = new DemoProvider();
    expect(provider.key).toBe("demo");
    expect(isSimulatedProvider(provider.key)).toBe(true);
  });

  it("returns the recorded text for the ticket and step, needing no API key or network", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const result = await new DemoProvider().complete(request("billing_agent_finding", DUP.subject));
      expect(result.text).toBe(DUP.responses.billing_agent_finding);
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
    }
  });

  it("reports zero tokens, because no model was called", async () => {
    const result = await new DemoProvider().complete(request("ticket_classification", DUP.subject));
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it("is deterministic: repeated calls, and separate instances, return byte-identical results", async () => {
    const a = new DemoProvider();
    const b = new DemoProvider();
    for (const task of Object.keys(DUP.responses)) {
      const first = await a.complete(request(task, DUP.subject));
      const again = await a.complete(request(task, DUP.subject));
      const other = await b.complete(request(task, DUP.subject));
      expect(again).toEqual(first);
      expect(other).toEqual(first);
      expect(JSON.stringify(other)).toBe(JSON.stringify(first));
    }
  });

  it("serves structured output the existing contracts accept", async () => {
    const text = (await new DemoProvider().complete(request("ticket_classification", DUP.subject))).text;
    expect(TicketClassificationSchema.safeParse(JSON.parse(text)).success).toBe(true);
  });

  it("recognizes the ticket from either prompt form (classifier and agents) and after a retry suffix", async () => {
    const provider = new DemoProvider();
    const classifierForm: CompletionRequest = {
      model: "m",
      system: "TASK: ticket_classification\nx",
      messages: [{ role: "user", content: `Ticket subject/summary: ${DUP.subject}\n\nConversation...` }],
    };
    expect((await provider.complete(classifierForm)).text).toBe(DUP.responses.ticket_classification);
    const retried = request("billing_agent_finding", DUP.subject, "\n\nYour previous output was invalid: fix it.");
    expect((await provider.complete(retried)).text).toBe(DUP.responses.billing_agent_finding);
  });

  it("gives different tickets different content (it is not one ticket's answer for everyone)", async () => {
    const provider = new DemoProvider();
    const a = await provider.complete(request("ticket_classification", DEMO_RECORDINGS["password-reset"].subject));
    const b = await provider.complete(request("ticket_classification", DUP.subject));
    expect(a.text).not.toBe(b.text);
  });

  describe("never invents fallback content", () => {
    it("rejects an unknown ticket with an explicit error", async () => {
      const provider = new DemoProvider();
      await expect(provider.complete(request("ticket_classification", "Some background ticket"))).rejects.toThrow(DemoRecordingNotFoundError);
      await expect(provider.complete(request("ticket_classification", "Some background ticket"))).rejects.toThrow(/curated evaluation scenarios only/);
    });

    it("rejects a step the scenario's recording does not include", async () => {
      // duplicate-billing runs billing + policy + response; it never runs Technical or Risk.
      expect(DUP.responses.technical_agent_finding).toBeUndefined();
      await expect(new DemoProvider().complete(request("technical_agent_finding", DUP.subject))).rejects.toThrow(
        new RegExp(`no response for the "technical_agent_finding" step`),
      );
      await expect(new DemoProvider().complete(request("risk_agent_finding", DUP.subject))).rejects.toThrow(DemoRecordingNotFoundError);
    });

    it("rejects a request with no recognizable step or no recognizable ticket", async () => {
      const provider = new DemoProvider();
      await expect(provider.complete({ model: "m", messages: [{ role: "user", content: `Ticket: ${DUP.subject}` }] })).rejects.toThrow(/pipeline step/);
      await expect(provider.complete({ model: "m", system: "TASK: ticket_classification", messages: [{ role: "user", content: "no ticket line here" }] })).rejects.toThrow(/identify the ticket/);
    });

    it("does not match a subject that merely resembles a recorded one", async () => {
      await expect(new DemoProvider().complete(request("ticket_classification", `${DUP.subject} (copy)`))).rejects.toThrow(DemoRecordingNotFoundError);
    });
  });

  it("uses the recording keyed by scenario, so DUP_KEY really is the duplicate-billing scenario", () => {
    expect(DUP_KEY).toBe("duplicate-billing");
    expect(DUP.subject).toBe("Charged twice this billing cycle");
  });
});
