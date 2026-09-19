import { AgentFindingSchema, KNOWN_AGENT_FLAGS } from "@/lib/ai/schemas";
import { retrieveRelevantProductDocs } from "../evidence";
import { formatConversation, formatProductDocs, buildSystemPrompt, JSON_ONLY_INSTRUCTION } from "../prompts";
import { runStructuredStep } from "../runStructuredStep";
import type { AgentContext, AgentResult, SpecialistAgent } from "../types";
import { degradedAgentFinding } from "./fallback";

function buildRequest(context: AgentContext, retryContext?: string) {
  const ticketText = `${context.ticketSummary} ${context.conversation.map((m) => m.body).join(" ")}`;
  const docs = retrieveRelevantProductDocs(context.accountContext.productDocs, ticketText);

  const system = buildSystemPrompt(
    "technical_agent_finding",
    `You are the Technical Support Agent for Halcyon. Diagnose the reported technical issue using ONLY the product documentation retrieved below (there may be none — if so, say the standard flow applies or that this needs manual investigation; do not invent a known issue that isn't documented).

Distinguish between three outcomes and set exactly one matching flag:
- "${KNOWN_AGENT_FLAGS.AUTO_RESOLVABLE}" — this is a standard, fully self-service flow with no account-specific issue (e.g. a routine password reset with no security flags) — nothing further to diagnose.
- "${KNOWN_AGENT_FLAGS.KNOWN_ISSUE_WORKAROUND_AVAILABLE}" — a retrieved doc describes this exact issue and its documented workaround, and the customer has NOT already said they tried it.
- "${KNOWN_AGENT_FLAGS.KNOWN_ISSUE_WORKAROUND_ALREADY_TRIED}" — same known issue, but the conversation indicates the customer already tried the documented workaround and it didn't help.
- "${KNOWN_AGENT_FLAGS.REQUIRES_ESCALATION}" — the workaround was already tried and failed (pair this with the flag above), OR this is a new issue with no matching documentation and clear evidence of a product defect.

Respond with JSON matching: {"agentKey":"technical","summary":string,"evidence":string[],"confidence":number 0-1,"policyReferences":[],"flags":string[]}. ${JSON_ONLY_INSTRUCTION}`,
  );

  const user = `Ticket: ${context.ticketSummary}

Conversation:
${formatConversation(context.conversation)}

Retrieved product documentation:
${formatProductDocs(docs)}
${retryContext ? `\n${retryContext}` : ""}`;

  return { system, messages: [{ role: "user" as const, content: user }] };
}

export const technicalAgent: SpecialistAgent = {
  key: "technical",
  description:
    "Diagnoses technical issues using product documentation and known-issue history.",
  async run(context): Promise<AgentResult> {
    const { data, parseError, metrics } = await runStructuredStep(
      "technical",
      AgentFindingSchema,
      (retryContext) => buildRequest(context, retryContext),
    );
    return {
      finding: data ?? degradedAgentFinding("technical", parseError!),
      metrics,
    };
  },
};
