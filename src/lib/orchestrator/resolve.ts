import {
  KNOWN_AGENT_FLAGS,
  isPolicyFinding,
  isRiskFinding,
  type AnyAgentFinding,
  type EscalationDecision,
  type ResolutionDecision,
  type TicketClassification,
} from "@/lib/ai/schemas";

export interface ResolveOutcomeResult {
  resolution: ResolutionDecision;
  escalation: EscalationDecision | null;
}

/** The one policy this invariant is grounded in — a deterministic reference,
 * not a citation a model produced. */
const ACCOUNT_SECURITY_POLICY_SLUG = "account-security-policy";
const ACCOUNT_SECURITY_ESCALATION_REASON = `Per ${ACCOUNT_SECURITY_POLICY_SLUG}: suspected account compromise must always be escalated to Trust & Safety and not resolved directly.`;
/** ResolutionDecision.summary / EscalationDecision.reason are capped at 400 chars. */
const MAX_TEXT = 400;

function fitToLimit(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

function average(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}

/**
 * Deterministic aggregation from classification + specialist findings to a
 * final resolution/escalation. Not a model call: this is a routing/priority
 * decision over already-structured evidence, and keeping it deterministic
 * is what makes it explainable and directly unit-testable (see CLAUDE.md,
 * "Explicit orchestrator, not a framework"; DECISIONS.md, "Why agents are
 * dynamically selected" makes the analogous argument for selectAgents()).
 *
 * Priority order (first match wins) mirrors the synthetic Escalation
 * Policy: a failed classification or a Risk-recommended escalation always
 * wins, and so does a suspected account compromise (Account Security Policy,
 * enforced deterministically below); a Policy Agent decision governs
 * refund/deny outcomes; Technical's flags govern technical resolutions
 * (except that, for a `failed_payment` ticket, Billing's payment-failed flag
 * governs ahead of Technical's non-escalating flags); Billing's flags cover
 * payment-status replies; anything left over falls through to a
 * confidence-based default.
 */
export function resolveOutcome(
  classification: TicketClassification,
  classificationFailed: boolean,
  findings: AnyAgentFinding[],
): ResolveOutcomeResult {
  const investigative = findings.filter((f) => f.agentKey !== "response");
  const policyFinding = investigative.find(isPolicyFinding);
  const riskFinding = investigative.find(isRiskFinding);
  const technicalFinding = investigative.find((f) => f.agentKey === "technical");
  const billingFinding = investigative.find((f) => f.agentKey === "billing");
  const anyAgentFailed = investigative.some((f) => f.flags.includes(KNOWN_AGENT_FLAGS.AGENT_FAILED));

  // 1. Classification itself failed — nothing downstream can be trusted.
  if (classificationFailed) {
    return {
      resolution: {
        action: "escalate",
        summary: "Ticket classification failed after retrying; routing to a human for manual triage.",
        confidence: 0,
        requiresHumanReview: true,
      },
      escalation: {
        required: true,
        reason: "AI classification failed to produce valid output after retrying.",
        targetTeam: "senior_support",
        severity: "medium",
      },
    };
  }

  // 1b. Account Security Policy: reports of suspicious account activity "must
  // always be escalated to Trust & Safety" and not resolved directly
  // (pre-live spec; the evaluation table says "Security always escalates,
  // regardless of other findings"). Enforced here, deterministically, so it
  // does not depend on the Risk agent choosing to recommend escalation or on
  // which team it names. Severity is not redefined: Risk's is kept when
  // supplied, otherwise the same default rule 2 already uses. The trigger is
  // still the classified intent, itself model-derived.
  if (classification.intent === "account_security") {
    const riskDetail = riskFinding?.escalationRecommended
      ? (riskFinding.escalationReason ?? riskFinding.summary)
      : null;
    const reason = fitToLimit(
      riskDetail ? `${ACCOUNT_SECURITY_ESCALATION_REASON} Risk assessment: ${riskDetail}` : ACCOUNT_SECURITY_ESCALATION_REASON,
    );
    return {
      resolution: {
        action: "escalate",
        summary: reason,
        confidence: riskFinding?.escalationRecommended ? riskFinding.confidence : classification.confidence,
        requiresHumanReview: true,
      },
      escalation: {
        required: true,
        reason,
        targetTeam: "trust_and_safety",
        severity: riskFinding?.severity ?? "medium",
      },
    };
  }

  // 2. Risk agent is the authoritative escalation source.
  if (riskFinding?.escalationRecommended) {
    return {
      resolution: {
        action: "escalate",
        summary: riskFinding.escalationReason ?? riskFinding.summary,
        confidence: riskFinding.confidence,
        requiresHumanReview: true,
      },
      escalation: {
        required: true,
        reason: riskFinding.escalationReason ?? riskFinding.summary,
        targetTeam: riskFinding.targetTeam ?? "senior_support",
        severity: riskFinding.severity ?? "medium",
      },
    };
  }

  // 3. Policy agent ran but couldn't reach or gave an ambiguous decision.
  if (policyFinding && (policyFinding.policyDecision === null || policyFinding.policyDecision.decision === "requires_review")) {
    return {
      resolution: {
        action: "escalate",
        summary:
          policyFinding.policyDecision?.justification ??
          "Policy agent could not determine which policy applies or whether its conditions are met.",
        confidence: policyFinding.confidence,
        requiresHumanReview: true,
      },
      escalation: {
        required: true,
        reason:
          policyFinding.policyDecision?.justification ??
          "Policy applicability is ambiguous and needs Billing Ops review.",
        targetTeam: "billing_ops",
        severity: "low",
      },
    };
  }

  // 4. Policy approved the request (e.g. a refund).
  if (policyFinding?.policyDecision?.decision === "approve") {
    return {
      resolution: {
        action: "refund_customer",
        summary: policyFinding.policyDecision.justification,
        confidence: policyFinding.confidence,
        requiresHumanReview: false,
      },
      escalation: null,
    };
  }

  // 5. Policy denied the request.
  if (policyFinding?.policyDecision?.decision === "deny") {
    return {
      resolution: {
        action: "deny_request",
        summary: policyFinding.policyDecision.justification,
        confidence: policyFinding.confidence,
        requiresHumanReview: false,
      },
      escalation: null,
    };
  }

  // 6. Technical: workaround already tried and failed -> escalate to engineering.
  if (technicalFinding?.flags.includes(KNOWN_AGENT_FLAGS.REQUIRES_ESCALATION)) {
    return {
      resolution: {
        action: "escalate",
        summary: technicalFinding.summary,
        confidence: technicalFinding.confidence,
        requiresHumanReview: true,
      },
      escalation: {
        required: true,
        reason: technicalFinding.summary,
        targetTeam: "engineering",
        severity: "medium",
      },
    };
  }

  // 6b. failed_payment is Billing-owned: when Billing flags a failed payment
  // (its flag covers "the customer needs to act OR the system will auto-retry"),
  // that flag governs the outcome even if Technical also ran. Technical is given
  // only the ticket and product docs, never the invoice or subscription state,
  // so its `auto_resolvable` / known-issue flags are documentation-only and cannot
  // establish that an unpaid invoice is resolved. Placed after rule 6 on purpose:
  // Technical's escalation still wins. Scoped to this intent; every other intent
  // keeps rules 7-9 as they were. Same outcome as rule 9. See DECISIONS.md
  // ("failed_payment is Billing-owned at resolution").
  if (
    classification.intent === "failed_payment" &&
    billingFinding?.flags.includes(KNOWN_AGENT_FLAGS.PAYMENT_FAILED_AWAITING_CUSTOMER_ACTION)
  ) {
    return {
      resolution: {
        action: "reply_and_monitor",
        summary: billingFinding.summary,
        confidence: billingFinding.confidence,
        requiresHumanReview: false,
      },
      escalation: null,
    };
  }

  // 7. Technical: standard self-service flow, nothing further to do.
  if (technicalFinding?.flags.includes(KNOWN_AGENT_FLAGS.AUTO_RESOLVABLE)) {
    return {
      resolution: {
        action: "auto_resolve",
        summary: technicalFinding.summary,
        confidence: technicalFinding.confidence,
        requiresHumanReview: false,
      },
      escalation: null,
    };
  }

  // 8. Technical: known issue, workaround not yet tried.
  if (technicalFinding?.flags.includes(KNOWN_AGENT_FLAGS.KNOWN_ISSUE_WORKAROUND_AVAILABLE)) {
    return {
      resolution: {
        action: "reply_and_close",
        summary: technicalFinding.summary,
        confidence: technicalFinding.confidence,
        requiresHumanReview: false,
      },
      escalation: null,
    };
  }

  // 9. Billing: payment failed, ball is in the customer's court.
  if (billingFinding?.flags.includes(KNOWN_AGENT_FLAGS.PAYMENT_FAILED_AWAITING_CUSTOMER_ACTION)) {
    return {
      resolution: {
        action: "reply_and_monitor",
        summary: billingFinding.summary,
        confidence: billingFinding.confidence,
        requiresHumanReview: false,
      },
      escalation: null,
    };
  }

  // 10. One or more selected agents outright failed and nothing above
  // already produced a confident decision — be conservative.
  if (anyAgentFailed) {
    return {
      resolution: {
        action: "escalate",
        summary: "One or more specialist agents failed to produce a valid result for this ticket.",
        confidence: 0,
        requiresHumanReview: true,
      },
      escalation: {
        required: true,
        reason: "Agent failure during orchestration.",
        targetTeam: "senior_support",
        severity: "low",
      },
    };
  }

  // 11. No specialist agents ran at all — genuinely ambiguous ticket.
  if (investigative.length === 0) {
    return {
      resolution: {
        action: "reply_and_monitor",
        summary: "No specific product or account issue detected; requesting clarification from the customer.",
        confidence: classification.confidence,
        requiresHumanReview: false,
      },
      escalation: null,
    };
  }

  // 12. Default: close out based on overall specialist confidence.
  const overallConfidence = average(investigative.map((f) => f.confidence));
  const confidenceThreshold = 0.6;
  return {
    resolution: {
      action: overallConfidence >= confidenceThreshold ? "reply_and_close" : "reply_and_monitor",
      summary: "Resolved based on specialist agent findings.",
      confidence: overallConfidence,
      requiresHumanReview: overallConfidence < confidenceThreshold,
    },
    escalation: null,
  };
}
