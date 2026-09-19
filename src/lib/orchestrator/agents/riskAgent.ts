import { RiskAgentFindingSchema, type RiskAgentFinding } from "@/lib/ai/schemas";
import {
  chargebackCount,
  retrieveRelevantPolicies,
  filterGroundedPolicyReferences,
  summarizePriorFindings,
} from "../evidence";
import { formatConversation, formatPolicies, buildSystemPrompt, JSON_ONLY_INSTRUCTION } from "../prompts";
import { runStructuredStep } from "../runStructuredStep";
import type { AgentContext, AgentResult, SpecialistAgent } from "../types";
import type { TicketDataContext } from "../context";
import { degradedRiskFinding } from "./fallback";

function buildRequest(context: AgentContext, retrievedPolicies: TicketDataContext["policies"], retryContext?: string) {
  const { accountContext, classification } = context;
  const chargebacks = chargebackCount(accountContext.transactions);

  const system = buildSystemPrompt(
    "risk_agent_finding",
    `You are the Risk / Escalation Agent for Halcyon — the last check before a ticket is resolved automatically. You review the ticket, the account's risk signals, and every other agent's findings so far, and decide whether this needs to escalate to a human team instead of being resolved automatically.

Escalate when: suspected account compromise or fraud, a high account risk score combined with an unusual request, conflicting or low-confidence findings from other agents, a documented technical workaround that already failed, or angry/urgent sentiment after a resolution attempt has already failed once. Use the retrieved policy below to choose the correct targetTeam: "trust_and_safety" for suspected compromise/fraud, "engineering" for an unresolved technical defect, "billing_ops" for an ambiguous billing/policy question, "senior_support" for everything else that still needs a human.

Do not escalate reflexively — most tickets should NOT escalate. Only recommend it when the evidence actually warrants it.

When a retrieved policy below directly informed your decision (e.g. the Account Security Policy requires escalating suspected compromise), cite it in "policyReferences" with its exact slug and title. You may ONLY cite a slug that appears in the "Relevant policy" section below — never a policy you know of but that wasn't retrieved for this call. Leave "policyReferences" empty if no retrieved policy applies.

Respond with JSON matching: {"agentKey":"risk","summary":string,"evidence":string[],"confidence":number 0-1,"policyReferences":[{"slug":string,"title":string}],"flags":[],"escalationRecommended":boolean,"escalationReason":string|null,"targetTeam":"billing_ops"|"trust_and_safety"|"engineering"|"senior_support"|null,"severity":"low"|"medium"|"high"|"critical"|null}
${JSON_ONLY_INSTRUCTION}`,
  );

  const user = `Ticket: ${context.ticketSummary}
Classification: intent=${classification.intent}, sentiment=${classification.sentiment}, confidence=${classification.confidence}

Conversation:
${formatConversation(context.conversation)}

Account risk score: ${accountContext.account?.riskScore ?? "n/a"}/100
Chargebacks on file: ${chargebacks}

Findings from agents that already ran on this ticket:
${summarizePriorFindings(context.priorFindings)}

Relevant policy:
${formatPolicies(retrievedPolicies)}
${retryContext ? `\n${retryContext}` : ""}`;

  return { system, messages: [{ role: "user" as const, content: user }] };
}

/** Same grounding enforcement as the Policy Agent (see policyAgent.ts):
 * strip any policy citation that wasn't among the policies actually
 * retrieved for this call, since the schema alone can't catch a
 * fabricated slug. Risk's core decision (escalationRecommended/targetTeam)
 * isn't citation-dependent, so an ungrounded reference is stripped rather
 * than invalidating the whole finding. */
function enforceGroundedCitations(
  finding: RiskAgentFinding,
  retrievedPolicies: TicketDataContext["policies"],
): RiskAgentFinding {
  return { ...finding, policyReferences: filterGroundedPolicyReferences(finding.policyReferences, retrievedPolicies) };
}

export const riskAgent: SpecialistAgent = {
  key: "risk",
  description:
    "Assesses security, fraud, and churn risk signals and recommends escalation when warranted.",
  async run(context): Promise<AgentResult> {
    const retrievedPolicies = retrieveRelevantPolicies(context.accountContext.policies, context.classification, {
      alwaysInclude: ["escalation-policy", "account-security-policy"],
    });
    const { data, parseError, metrics } = await runStructuredStep(
      "risk",
      RiskAgentFindingSchema,
      (retryContext) => buildRequest(context, retrievedPolicies, retryContext),
    );
    const finding = data
      ? enforceGroundedCitations(data, retrievedPolicies)
      : degradedRiskFinding(parseError!);
    return { finding, metrics };
  },
};
