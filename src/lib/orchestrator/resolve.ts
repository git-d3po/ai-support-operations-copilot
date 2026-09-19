import type {
  AgentFinding,
  EscalationDecision,
  ResolutionDecision,
} from "@/lib/ai/schemas";

/**
 * Aggregates specialist findings into a final resolution (and, if
 * warranted, an escalation). Phase 2 replaces this with real aggregation
 * logic — currently a deterministic placeholder so OrchestrationRun rows
 * have a complete, schema-valid shape end to end.
 */
export function resolveOutcome(findings: AgentFinding[]): {
  resolution: ResolutionDecision;
  escalation: EscalationDecision | null;
} {
  const escalate = findings.some((f) => f.flags.includes("requires_escalation"));

  const resolution: ResolutionDecision = {
    action: escalate ? "escalate" : "reply_and_close",
    summary: "Resolution aggregation not yet implemented (foundation phase).",
    confidence: 0,
    requiresHumanReview: true,
  };

  const escalation: EscalationDecision | null = escalate
    ? {
        required: true,
        reason: "One or more agents flagged this ticket for escalation.",
        targetTeam: "senior_support",
        severity: "medium",
      }
    : null;

  return { resolution, escalation };
}
