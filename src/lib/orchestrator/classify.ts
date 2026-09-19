import { TICKET_INTENTS, TicketClassificationSchema, type TicketClassification } from "@/lib/ai/schemas";
import { buildSystemPrompt, formatConversation, JSON_ONLY_INSTRUCTION } from "./prompts";
import { runStructuredStep } from "./runStructuredStep";
import type { AgentContext } from "./types";

export interface ClassifyResult {
  classification: TicketClassification;
  /** True when the model never produced valid output after retrying —
   * resolveOutcome() treats this as "cannot trust anything downstream"
   * and escalates rather than proceeding on a guessed classification. */
  failed: boolean;
  metrics: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    estimatedCostUsd: number;
  };
}

const FALLBACK_CLASSIFICATION: TicketClassification = {
  intent: "general_inquiry",
  domains: [],
  sentiment: "neutral",
  confidence: 0,
  summary: "Classification failed after retrying — routed for manual triage.",
  keyEvidence: [],
};

function buildRequest(context: Pick<AgentContext, "ticketSummary" | "conversation">, retryContext?: string) {
  const system = buildSystemPrompt(
    "ticket_classification",
    `You are the ticket classification step of Halcyon's support pipeline. Read the ticket and classify it.

intent: exactly one of ${TICKET_INTENTS.map((i) => `"${i}"`).join(", ")}.
domains: which specialist areas this ticket touches — a subset of ["billing","policy","technical","risk"]. Can be empty for a genuinely vague or general request. Include "policy" when a policy document would govern the outcome (e.g. refunds, cancellations), not just when money is involved.
sentiment: "neutral" | "frustrated" | "urgent" | "angry" — based on the customer's actual tone, not the topic.
confidence: your genuine confidence in this classification, 0-1.
summary: one concise sentence.
keyEvidence: up to 6 short phrases quoted or closely paraphrased from the ticket that justify the classification.

Respond with JSON matching: {"intent":string,"domains":string[],"sentiment":string,"confidence":number,"summary":string,"keyEvidence":string[]}
${JSON_ONLY_INSTRUCTION}`,
  );

  const user = `Ticket subject/summary: ${context.ticketSummary}

Conversation:
${formatConversation(context.conversation)}
${retryContext ? `\n${retryContext}` : ""}`;

  return { system, messages: [{ role: "user" as const, content: user }] };
}

/** Real classification, routed via callModel("classifier", ...) per
 * modelRouting.ts. Falls back to a safe, honest placeholder (never a
 * guessed real category) if the model can't produce valid output after
 * retrying. */
export async function classifyTicket(
  context: Pick<AgentContext, "ticketSummary" | "conversation">,
): Promise<ClassifyResult> {
  const { data, metrics } = await runStructuredStep(
    "classifier",
    TicketClassificationSchema,
    (retryContext) => buildRequest(context, retryContext),
  );

  if (!data) {
    return { classification: FALLBACK_CLASSIFICATION, failed: true, metrics };
  }
  return { classification: data, failed: false, metrics };
}
