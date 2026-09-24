import {
  KNOWN_AGENT_FLAGS,
  type AgentKey,
  type EscalationDecision,
  type PolicyDecision,
  type ResolutionDecision,
  type TicketClassification,
  type TicketIntent,
  type CustomerResponse,
} from "@/lib/ai/schemas";

/**
 * The single source of truth for how canonical values are SHOWN to an
 * operator. Presentation only: the canonical values themselves (stored in the
 * database, used by the orchestrator, routing, resolution rules and the
 * evaluation scorer) are never changed here, and nothing should compare
 * against a label.
 *
 * Maps typed against the schema's own enums (`Record<TicketIntent, string>`
 * and so on) are checked for completeness by the compiler, so adding a value
 * to the taxonomy without a label fails the typecheck rather than silently
 * rendering `snake_case` in the UI. Plain database strings (ticket status,
 * account plan) have no schema enum, so their maps are keyed by string and
 * fall back to `humanizeIdentifier()`.
 */

type ResolutionAction = ResolutionDecision["action"];
type EscalationTeam = EscalationDecision["targetTeam"];
type Severity = EscalationDecision["severity"];
type Sentiment = TicketClassification["sentiment"];
type PolicyDecisionValue = PolicyDecision["decision"];
type ResponseTone = CustomerResponse["tone"];

/** Fallback for an open vocabulary (e.g. an agent flag outside the known list): `past_due` -> `Past due`. */
export function humanizeIdentifier(value: string): string {
  const words = value.replace(/[_-]+/g, " ").trim();
  return words.length === 0 ? value : words.charAt(0).toUpperCase() + words.slice(1);
}

function lookup(map: Record<string, string>, value: string): string {
  return Object.hasOwn(map, value) ? map[value] : humanizeIdentifier(value);
}

export const TICKET_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  pending: "Pending",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  chat: "Chat",
  in_app: "In-app",
};

export const MESSAGE_AUTHOR_LABELS: Record<string, string> = {
  customer: "Customer",
  agent: "Support agent",
};

export const ACTION_LABELS: Record<ResolutionAction, string> = {
  auto_resolve: "Auto-resolve",
  reply_and_close: "Reply and close",
  reply_and_monitor: "Reply and monitor",
  escalate: "Escalate",
  refund_customer: "Refund customer",
  deny_request: "Deny request",
};

export const TEAM_LABELS: Record<EscalationTeam, string> = {
  billing_ops: "Billing Ops",
  trust_and_safety: "Trust & Safety",
  engineering: "Engineering",
  senior_support: "Senior Support",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const INTENT_LABELS: Record<TicketIntent, string> = {
  password_reset: "Password reset",
  duplicate_charge: "Duplicate charge",
  refund_request: "Refund request",
  failed_payment: "Failed payment",
  billing_question: "Billing question",
  technical_issue: "Technical issue",
  account_security: "Account security",
  cancellation: "Cancellation",
  feature_question: "Feature question",
  general_inquiry: "General inquiry",
};

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  neutral: "Neutral",
  frustrated: "Frustrated",
  urgent: "Urgent",
  angry: "Angry",
};

export const POLICY_DECISION_LABELS: Record<PolicyDecisionValue, string> = {
  approve: "Approve",
  deny: "Deny",
  requires_review: "Requires review",
};

export const RESPONSE_TONE_LABELS: Record<ResponseTone, string> = {
  empathetic: "Empathetic",
  neutral: "Neutral",
  apologetic: "Apologetic",
  direct: "Direct",
};

/** Pipeline steps as persisted on `AgentInvocation.agentKey`: the classifier plus every specialist. */
export const AGENT_LABELS: Record<AgentKey | "classifier", string> = {
  classifier: "Classification",
  billing: "Billing Agent",
  policy: "Policy Agent",
  technical: "Technical Support Agent",
  risk: "Risk / Escalation Agent",
  response: "Response Agent",
};

/** Compact names for tight spaces (the pipeline strip, classification domains). */
export const AGENT_SHORT_LABELS: Record<AgentKey | "classifier", string> = {
  classifier: "Classifier",
  billing: "Billing",
  policy: "Policy",
  technical: "Technical",
  risk: "Risk",
  response: "Response",
};

export const INVOCATION_STATUS_LABELS: Record<string, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
};

export const ACCOUNT_PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
  enterprise: "Enterprise",
};

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  past_due: "Past due",
  trialing: "Trialing",
  canceled: "Canceled",
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  paid: "Paid",
  past_due: "Past due",
};

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  charge: "Charge",
  refund: "Refund",
  chargeback: "Chargeback",
};

export const TRANSACTION_STATUS_LABELS: Record<string, string> = {
  succeeded: "Succeeded",
  failed: "Failed",
};

type KnownFlag = (typeof KNOWN_AGENT_FLAGS)[keyof typeof KNOWN_AGENT_FLAGS];

/** Labels for the flags resolution logic reads (see KNOWN_AGENT_FLAGS). Agents may set other, informational flags; those fall back to `humanizeIdentifier()`. */
export const AGENT_FLAG_LABELS: Record<KnownFlag, string> = {
  agent_failed: "Agent failed",
  duplicate_charge_confirmed: "Duplicate charge confirmed",
  payment_failed_awaiting_customer_action: "Payment failed, awaiting customer action",
  no_billing_issue_found: "No billing issue found",
  known_issue_workaround_available: "Known-issue workaround available",
  known_issue_workaround_already_tried: "Known-issue workaround already tried",
  requires_escalation: "Requires escalation",
  auto_resolvable: "Auto-resolvable",
  ungrounded_policy_citation: "Ungrounded policy citation",
};

export const labelTicketStatus = (value: string) => lookup(TICKET_STATUS_LABELS, value);
export const labelPriority = (value: string) => lookup(PRIORITY_LABELS, value);
export const labelChannel = (value: string) => lookup(CHANNEL_LABELS, value);
export const labelMessageAuthor = (value: string) => lookup(MESSAGE_AUTHOR_LABELS, value);
export const labelAction = (value: string) => lookup(ACTION_LABELS, value);
export const labelTeam = (value: string) => lookup(TEAM_LABELS, value);
export const labelSeverity = (value: string) => lookup(SEVERITY_LABELS, value);
export const labelIntent = (value: string) => lookup(INTENT_LABELS, value);
export const labelSentiment = (value: string) => lookup(SENTIMENT_LABELS, value);
export const labelPolicyDecision = (value: string) => lookup(POLICY_DECISION_LABELS, value);
export const labelResponseTone = (value: string) => lookup(RESPONSE_TONE_LABELS, value);
export const labelAgent = (value: string) => lookup(AGENT_LABELS, value);
export const labelAgentShort = (value: string) => lookup(AGENT_SHORT_LABELS, value);
export const labelInvocationStatus = (value: string) => lookup(INVOCATION_STATUS_LABELS, value);
export const labelAccountPlan = (value: string) => lookup(ACCOUNT_PLAN_LABELS, value);
export const labelAccountStatus = (value: string) => lookup(ACCOUNT_STATUS_LABELS, value);
export const labelInvoiceStatus = (value: string) => lookup(INVOICE_STATUS_LABELS, value);
export const labelTransactionType = (value: string) => lookup(TRANSACTION_TYPE_LABELS, value);
export const labelTransactionStatus = (value: string) => lookup(TRANSACTION_STATUS_LABELS, value);
export const labelAgentFlag = (value: string) => lookup(AGENT_FLAG_LABELS, value);
