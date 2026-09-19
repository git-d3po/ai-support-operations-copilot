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

// ---------------------------------------------------------------------------
// Policy Agent's specific decision artifact (in addition to its AgentFinding)
// ---------------------------------------------------------------------------

export const PolicyDecisionSchema = z.object({
  applicablePolicy: PolicyReferenceSchema,
  decision: z.enum(["approve", "deny", "requires_review"]),
  justification: z.string().max(400),
  conditionsMet: z.array(z.string()).default([]),
  conditionsUnmet: z.array(z.string()).default([]),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

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
