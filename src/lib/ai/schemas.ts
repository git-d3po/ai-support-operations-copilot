import { z } from "zod";

/**
 * Structured-output contracts for every AI-produced artifact in the product.
 *
 * These are the only shapes an agent, the orchestrator, or the evaluation
 * system is allowed to produce. Nothing here carries chain-of-thought —
 * every field is a concise, inspectable artifact (a decision, a confidence
 * score, a citation), never a reasoning transcript. See ARCHITECTURE.md
 * ("Structured outputs, not chain-of-thought") for the rationale.
 */

// ---------------------------------------------------------------------------
// Shared vocabularies
// ---------------------------------------------------------------------------

export const AGENT_KEYS = [
  "billing",
  "policy",
  "technical",
  "risk",
  "response",
] as const;
export const AgentKeySchema = z.enum(AGENT_KEYS);
export type AgentKey = z.infer<typeof AgentKeySchema>;

export const TICKET_INTENTS = [
  "password_reset",
  "duplicate_charge",
  "refund_request",
  "failed_payment",
  "billing_question",
  "technical_issue",
  "account_security",
  "cancellation",
  "feature_question",
  "general_inquiry",
] as const;
export const TicketIntentSchema = z.enum(TICKET_INTENTS);
export type TicketIntent = z.infer<typeof TicketIntentSchema>;

export const ESCALATION_TEAMS = [
  "billing_ops",
  "trust_and_safety",
  "engineering",
  "senior_support",
] as const;
export const EscalationTeamSchema = z.enum(ESCALATION_TEAMS);

export const RESOLUTION_ACTIONS = [
  "auto_resolve",
  "reply_and_close",
  "reply_and_monitor",
  "escalate",
  "refund_customer",
  "deny_request",
] as const;
export const ResolutionActionSchema = z.enum(RESOLUTION_ACTIONS);

const ConfidenceSchema = z.number().min(0).max(1);

const PolicyReferenceSchema = z.object({
  slug: z.string(),
  title: z.string(),
});
export type PolicyReference = z.infer<typeof PolicyReferenceSchema>;

// ---------------------------------------------------------------------------
// Classification — first step of every orchestration run
// ---------------------------------------------------------------------------

export const TicketClassificationSchema = z.object({
  intent: TicketIntentSchema,
  domains: z
    .array(AgentKeySchema.exclude(["response"]))
    .describe(
      "Which specialist domains this ticket touches. Can be empty for genuinely ambiguous or general-inquiry tickets — see selectAgents.ts.",
    ),
  sentiment: z.enum(["neutral", "frustrated", "urgent", "angry"]),
  confidence: ConfidenceSchema,
  summary: z.string().max(280),
  keyEvidence: z.array(z.string()).max(6),
});
export type TicketClassification = z.infer<typeof TicketClassificationSchema>;

// ---------------------------------------------------------------------------
// Specialist agent output — every agent (billing/policy/technical/risk)
// returns this same envelope so the UI can render them uniformly.
// ---------------------------------------------------------------------------

export const AgentFindingSchema = z.object({
  agentKey: AgentKeySchema,
  summary: z.string().max(400),
  evidence: z.array(z.string()).max(8),
  confidence: ConfidenceSchema,
  policyReferences: z.array(PolicyReferenceSchema).max(5).default([]),
  flags: z.array(z.string()).max(5).default([]),
});
export type AgentFinding = z.infer<typeof AgentFindingSchema>;

/**
 * Controlled flag vocabulary `resolveOutcome()` actually reads (see
 * resolve.ts). Flags outside this list are allowed (agents can note
 * something informational) but only these drive resolution logic — this
 * list is the contract between agent prompts and resolution, not an
 * enforced enum, so it can grow without a schema migration.
 */
export const KNOWN_AGENT_FLAGS = {
  AGENT_FAILED: "agent_failed",
  DUPLICATE_CHARGE_CONFIRMED: "duplicate_charge_confirmed",
  PAYMENT_FAILED_AWAITING_CUSTOMER_ACTION: "payment_failed_awaiting_customer_action",
  NO_BILLING_ISSUE_FOUND: "no_billing_issue_found",
  KNOWN_ISSUE_WORKAROUND_AVAILABLE: "known_issue_workaround_available",
  KNOWN_ISSUE_WORKAROUND_ALREADY_TRIED: "known_issue_workaround_already_tried",
  REQUIRES_ESCALATION: "requires_escalation",
  AUTO_RESOLVABLE: "auto_resolvable",
} as const;

// ---------------------------------------------------------------------------
// Policy Agent — extends AgentFinding with its required decision artifact.
// A dedicated schema (rather than stuffing this into AgentFinding.flags as
// strings) because "which policy, what decision, which conditions" is
// exactly the structured, citable artifact the product spec calls for —
// see DECISIONS.md ("Policy and Risk agents extend AgentFinding").
// ---------------------------------------------------------------------------

export const PolicyDecisionSchema = z.object({
  applicablePolicy: PolicyReferenceSchema,
  decision: z.enum(["approve", "deny", "requires_review"]),
  justification: z.string().max(400),
  conditionsMet: z.array(z.string()).default([]),
  conditionsUnmet: z.array(z.string()).default([]),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

export const PolicyAgentFindingSchema = AgentFindingSchema.extend({
  agentKey: z.literal("policy"),
  /** Null only when the agent could not reach a decision (e.g. no policy
   * applies, or it failed) — resolveOutcome treats null as "needs human
   * review," never as "no policy issue." */
  policyDecision: PolicyDecisionSchema.nullable(),
});
export type PolicyAgentFinding = z.infer<typeof PolicyAgentFindingSchema>;

// ---------------------------------------------------------------------------
// Risk Agent — extends AgentFinding with its escalation recommendation.
// ---------------------------------------------------------------------------

export const RiskAgentFindingSchema = AgentFindingSchema.extend({
  agentKey: z.literal("risk"),
  escalationRecommended: z.boolean(),
  escalationReason: z.string().max(400).nullable(),
  targetTeam: EscalationTeamSchema.nullable(),
  severity: z.enum(["low", "medium", "high", "critical"]).nullable(),
});
export type RiskAgentFinding = z.infer<typeof RiskAgentFindingSchema>;

/** Any specialist agent's finding, as actually stored/rendered — a plain
 * AgentFinding for Billing/Technical/Response, or one of the two extended
 * shapes above for Policy/Risk. */
export type AnyAgentFinding = AgentFinding | PolicyAgentFinding | RiskAgentFinding;

/**
 * Type guards for narrowing `AnyAgentFinding`. Note: a plain
 * `finding.agentKey === "policy"` check does NOT narrow the union for
 * TypeScript here, because `AgentFinding.agentKey` is typed as the full
 * `AgentKey` enum (not a literal excluding "policy"/"risk") — these guards
 * narrow on the presence of each extended shape's unique field instead,
 * which TypeScript can verify structurally.
 */
export function isPolicyFinding(finding: AnyAgentFinding): finding is PolicyAgentFinding {
  return "policyDecision" in finding;
}
export function isRiskFinding(finding: AnyAgentFinding): finding is RiskAgentFinding {
  return "escalationRecommended" in finding;
}

// ---------------------------------------------------------------------------
// Resolution & escalation — the orchestrator's final call
// ---------------------------------------------------------------------------

export const ResolutionDecisionSchema = z.object({
  action: ResolutionActionSchema,
  summary: z.string().max(400),
  confidence: ConfidenceSchema,
  requiresHumanReview: z.boolean(),
});
export type ResolutionDecision = z.infer<typeof ResolutionDecisionSchema>;

export const EscalationDecisionSchema = z.object({
  required: z.literal(true),
  reason: z.string().max(400),
  targetTeam: EscalationTeamSchema,
  severity: z.enum(["low", "medium", "high", "critical"]),
});
export type EscalationDecision = z.infer<typeof EscalationDecisionSchema>;

// ---------------------------------------------------------------------------
// Customer-facing response — what the operator reviews before sending
// ---------------------------------------------------------------------------

export const CustomerResponseSchema = z.object({
  subject: z.string().max(140).optional(),
  body: z.string().max(3000),
  tone: z.enum(["empathetic", "neutral", "apologetic", "direct"]),
  nextSteps: z.array(z.string()).max(5).default([]),
});
export type CustomerResponse = z.infer<typeof CustomerResponseSchema>;

// ---------------------------------------------------------------------------
// Evaluation — expected outcomes (seed-time) and scored results (eval-time)
// ---------------------------------------------------------------------------

export const EvaluationExpectedOutcomeSchema = z.object({
  expectedIntent: TicketIntentSchema,
  expectedAgents: z.array(AgentKeySchema).min(1),
  expectedPolicySlug: z.string().nullable(),
  expectedEscalation: z.boolean(),
  expectedAction: ResolutionActionSchema,
  notes: z.string(),
});
export type EvaluationExpectedOutcome = z.infer<
  typeof EvaluationExpectedOutcomeSchema
>;

export const EvaluationResultSchema = z.object({
  classificationCorrect: z.boolean(),
  routingCorrect: z.boolean(),
  policyCorrect: z.boolean().nullable(),
  escalationCorrect: z.boolean(),
  resolutionCorrect: z.boolean(),
  evidenceQuality: ConfidenceSchema,
  overallScore: ConfidenceSchema,
  notes: z.string(),
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;
