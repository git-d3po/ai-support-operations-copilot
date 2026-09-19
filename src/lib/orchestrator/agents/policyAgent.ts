import { KNOWN_AGENT_FLAGS, PolicyAgentFindingSchema, type PolicyAgentFinding } from "@/lib/ai/schemas";
import {
  detectDuplicateCharges,
  mostRecentSucceededCharge,
  retrieveRelevantPolicies,
  filterGroundedPolicyReferences,
  isPolicyGrounded,
  daysSince,
} from "../evidence";
import {
  formatInvoices,
  formatTransactions,
  formatConversation,
  formatPolicies,
  buildSystemPrompt,
  JSON_ONLY_INSTRUCTION,
} from "../prompts";
import { runStructuredStep } from "../runStructuredStep";
import type { AgentContext, AgentResult, SpecialistAgent } from "../types";
import { degradedPolicyFinding } from "./fallback";
import type { TicketDataContext } from "../context";

function buildRequest(context: AgentContext, retrievedPolicies: TicketDataContext["policies"], retryContext?: string) {
  const { accountContext } = context;
  const duplicates = detectDuplicateCharges(accountContext.transactions);
  const mostRecentCharge = mostRecentSucceededCharge(accountContext.transactions);
  const daysSinceCharge = mostRecentCharge ? daysSince(mostRecentCharge.occurredAt, new Date()) : null;

  const system = buildSystemPrompt(
    "policy_agent_finding",
    `You are the Policy Agent for Halcyon, a B2B SaaS company. Given the ticket and the specific policy document(s) retrieved below (there may be none — if so, say so and set policyDecision to null), decide whether the requested action is permitted.

Ground your decision ONLY in the policy text provided and the concrete evidence provided (dates, amounts, days-since-charge) — do not invent policy conditions that aren't written in the retrieved policy text, and do not do your own date arithmetic: a pre-computed "days since most recent charge" value is provided below when relevant, trust it rather than recomputing from the raw dates.

If no retrieved policy actually applies to this ticket, set "policyDecision" to null and explain why in "summary" — do not force-fit an unrelated policy. You may ONLY cite a slug that appears in the "Retrieved policies" section below — never a policy you know of but that wasn't retrieved for this call.

Respond with JSON matching:
{"agentKey":"policy","summary":string,"evidence":string[],"confidence":number 0-1,"policyReferences":[{"slug":string,"title":string}],"flags":[],"policyDecision": null | {"applicablePolicy":{"slug":string,"title":string},"decision":"approve"|"deny"|"requires_review","justification":string,"conditionsMet":string[],"conditionsUnmet":string[]}}
${JSON_ONLY_INSTRUCTION}`,
  );

  const user = `Ticket: ${context.ticketSummary}

Conversation:
${formatConversation(context.conversation)}

Retrieved policies (only these govern your decision):
${formatPolicies(retrievedPolicies)}

Billing evidence:
${formatInvoices(accountContext.invoices)}

${formatTransactions(accountContext.transactions)}

Pre-computed facts:
- Days since most recent successful charge: ${daysSinceCharge ?? "n/a (no charges on file)"}
- Confirmed duplicate charges detected: ${duplicates.length > 0 ? `yes, ${duplicates.length} pair(s)` : "no"}
${retryContext ? `\n${retryContext}` : ""}`;

  return { system, messages: [{ role: "user" as const, content: user }] };
}

/**
 * Enforces grounding rather than just prompting for it: a model can claim
 * a policy citation the schema alone can't catch, since
 * `PolicyReferenceSchema` only validates shape (two strings), not that the
 * slug is real or was actually retrieved for this call. Any citation
 * outside `retrievedPolicies` is stripped from `policyReferences`, and if
 * the decision's own `applicablePolicy` isn't grounded, the decision is
 * discarded entirely (never silently trusted) — resolveOutcome() already
 * treats a null policyDecision as "needs human review," so this fails
 * safe. See DECISIONS.md ("Enforcing, not just prompting for, grounded
 * policy citations").
 */
function enforceGroundedCitations(
  finding: PolicyAgentFinding,
  retrievedPolicies: TicketDataContext["policies"],
): PolicyAgentFinding {
  const groundedReferences = filterGroundedPolicyReferences(finding.policyReferences, retrievedPolicies);

  if (!finding.policyDecision) {
    return { ...finding, policyReferences: groundedReferences };
  }

  const citedSlug = finding.policyDecision.applicablePolicy.slug;
  if (isPolicyGrounded(citedSlug, retrievedPolicies)) {
    return { ...finding, policyReferences: groundedReferences };
  }

  return {
    ...finding,
    policyReferences: groundedReferences,
    policyDecision: null,
    confidence: 0,
    flags: [...finding.flags, KNOWN_AGENT_FLAGS.UNGROUNDED_POLICY_CITATION],
    summary: `${finding.summary} (citation to policy "${citedSlug}" could not be verified against the policies retrieved for this ticket — treated as no decision.)`,
  };
}

export const policyAgent: SpecialistAgent = {
  key: "policy",
  description:
    "Matches the ticket against company policy documents and evaluates whether conditions are met.",
  async run(context): Promise<AgentResult> {
    const retrievedPolicies = retrieveRelevantPolicies(context.accountContext.policies, context.classification);
    const { data, parseError, metrics } = await runStructuredStep(
      "policy",
      PolicyAgentFindingSchema,
      (retryContext) => buildRequest(context, retrievedPolicies, retryContext),
    );
    const finding = data
      ? enforceGroundedCitations(data, retrievedPolicies)
      : degradedPolicyFinding(parseError!);
    return { finding, metrics };
  },
};
