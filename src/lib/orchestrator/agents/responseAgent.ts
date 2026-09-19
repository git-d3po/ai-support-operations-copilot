import { CustomerResponseSchema } from "@/lib/ai/schemas";
import { formatConversation, buildSystemPrompt, JSON_ONLY_INSTRUCTION } from "../prompts";
import { summarizePriorFindings } from "../evidence";
import { runStructuredStep } from "../runStructuredStep";
import type { AgentContext, AgentResult, SpecialistAgent } from "../types";
import { FALLBACK_CUSTOMER_RESPONSE } from "./fallback";

function buildRequest(context: AgentContext, retryContext?: string) {
  const { resolution, escalation } = context;
  if (!resolution) {
    throw new Error("Response agent requires a resolution decision in context — see orchestrator.ts");
  }

  const system = buildSystemPrompt(
    "response_agent_reply",
    `You are the Response Agent for Halcyon. Draft the customer-facing reply. You do NOT make policy or resolution decisions yourself — the resolution below has already been decided by the orchestration pipeline; your only job is to communicate it clearly, accurately, and with an appropriate tone. Never state a different outcome than the resolution provided. Never invent a policy justification not present in the findings below.

If the resolution escalates, tell the customer their request needs a closer look from the right team and set expectations — do not name internal team names. If it denies a request, explain why using the actual reasoning from the findings, without being curt. If it approves/refunds, confirm the action clearly. If it asks for more information, ask a specific clarifying question.

Respond with JSON matching: {"body":string,"tone":"empathetic"|"neutral"|"apologetic"|"direct","nextSteps":string[],"subject":string (optional)}
${JSON_ONLY_INSTRUCTION}`,
  );

  const user = `Ticket: ${context.ticketSummary}

Conversation so far:
${formatConversation(context.conversation)}

Resolution decision: action=${resolution.action}, summary="${resolution.summary}"
${escalation ? `Escalation: yes, reason="${escalation.reason}"` : "Escalation: no"}

Specialist agent findings:
${summarizePriorFindings(context.priorFindings)}
${retryContext ? `\n${retryContext}` : ""}`;

  return { system, messages: [{ role: "user" as const, content: user }] };
}

export const responseAgent: SpecialistAgent = {
  key: "response",
  description:
    "Drafts the proposed customer response from the resolution decision and the other agents' findings.",
  async run(context): Promise<AgentResult> {
    const { data, parseError, metrics } = await runStructuredStep(
      "response",
      CustomerResponseSchema,
      (retryContext) => buildRequest(context, retryContext),
    );

    return {
      finding: {
        agentKey: "response",
        summary: data
          ? "Drafted customer response from the resolution decision."
          : `Response drafting failed: ${parseError}`,
        evidence: [],
        confidence: data ? context.resolution?.confidence ?? 0.5 : 0,
        policyReferences: [],
        flags: data ? [] : ["agent_failed"],
      },
      metrics,
      response: data ?? FALLBACK_CUSTOMER_RESPONSE,
    };
  },
};
