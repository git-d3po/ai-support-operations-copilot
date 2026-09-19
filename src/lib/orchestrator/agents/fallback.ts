import {
  KNOWN_AGENT_FLAGS,
  type AgentFinding,
  type CustomerResponse,
  type PolicyAgentFinding,
  type RiskAgentFinding,
} from "@/lib/ai/schemas";

/**
 * What every agent falls back to when `runStructuredStep` couldn't get a
 * schema-valid response after retrying. These are the only "safe defaults"
 * in the system: honest about having failed (never a fabricated finding),
 * and — for Policy/Risk — deliberately conservative (null decision /
 * forced escalation) so `resolveOutcome()` never treats a failure as "no
 * issue found." See CLAUDE.md, "Never allow malformed model output to
 * silently enter the system."
 */

function truncate(text: string, max = 200): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function degradedAgentFinding(
  agentKey: "billing" | "technical",
  parseError: string,
): AgentFinding {
  return {
    agentKey,
    summary: `${agentKey} agent could not produce a valid result after retrying: ${truncate(parseError)}`,
    evidence: [],
    confidence: 0,
    policyReferences: [],
    flags: [KNOWN_AGENT_FLAGS.AGENT_FAILED],
  };
}

export function degradedPolicyFinding(parseError: string): PolicyAgentFinding {
  return {
    agentKey: "policy",
    summary: `Policy agent could not produce a valid result after retrying: ${truncate(parseError)}`,
    evidence: [],
    confidence: 0,
    policyReferences: [],
    flags: [KNOWN_AGENT_FLAGS.AGENT_FAILED],
    policyDecision: null,
  };
}

export function degradedRiskFinding(parseError: string): RiskAgentFinding {
  return {
    agentKey: "risk",
    summary: `Risk agent could not produce a valid result after retrying: ${truncate(parseError)}. Escalating out of caution.`,
    evidence: [],
    confidence: 0,
    policyReferences: [],
    flags: [KNOWN_AGENT_FLAGS.AGENT_FAILED],
    escalationRecommended: true,
    escalationReason: "Risk assessment failed to complete; escalating for manual review rather than proceeding blind.",
    targetTeam: "senior_support",
    severity: "medium",
  };
}

export const FALLBACK_CUSTOMER_RESPONSE: CustomerResponse = {
  body: "Thanks for reaching out. We're looking into your request and a member of our support team will follow up shortly.",
  tone: "neutral",
  nextSteps: ["A support operator will review this ticket manually."],
};
