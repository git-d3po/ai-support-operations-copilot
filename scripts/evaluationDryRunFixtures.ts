/**
 * Canned, deterministic responses for ALL 10 curated scenarios — used ONLY
 * by scripts/runEvaluationDryRun.ts to validate that the evaluation
 * pipeline (orchestrator → persistence → scorer → UI) is wired correctly
 * end to end, without a live model. This is NOT a claim about real model
 * behavior for any scenario; see DECISIONS.md ("Evaluation dry-run
 * fixture: validating the harness, not the model").
 *
 * 9 of the 10 scenarios are answered "correctly" (matching their
 * expectedOutcome) so a clean pipeline run produces 9 passes. ONE
 * scenario (known-technical-issue) is deliberately answered WRONG on
 * purpose, to prove the scorer actually detects and reports a failure
 * end-to-end through the real runner — not just in isolated unit tests.
 * See the comment on that scenario below.
 */
import { SCENARIOS } from "../prisma/data/scenarios";

const subjectToScenarioKey = new Map(SCENARIOS.map((s) => [s.ticket.subject, s.key]));

export function scenarioKeyForTicketSummary(userMessage: string): string | null {
  const match = userMessage.match(/^Ticket(?: subject\/summary)?: (.+)$/m);
  if (!match) return null;
  return subjectToScenarioKey.get(match[1].trim()) ?? null;
}

export function taskForSystemPrompt(system: string | undefined): string | null {
  return system?.match(/^TASK: (\S+)/)?.[1] ?? null;
}

type Fixtures = Record<string, Record<string, string>>;

/**
 * FIXTURES[scenarioKey][task] = canned JSON response.
 *
 * Only tasks that scenario's expected agent roster actually calls need an
 * entry — if the dry run somehow calls a task/scenario pair with no entry
 * here (e.g. a routing bug sends a ticket to an agent nobody expected),
 * the dry-run provider throws a clear error rather than guessing, which
 * itself would be a real finding.
 */
export const FIXTURES: Fixtures = {
  "password-reset": {
    ticket_classification: JSON.stringify({
      intent: "password_reset",
      domains: ["technical"],
      sentiment: "neutral",
      confidence: 0.93,
      summary: "Customer forgot their password and cannot log in.",
      keyEvidence: ["forgot my password", "can't log in"],
    }),
    technical_agent_finding: JSON.stringify({
      agentKey: "technical",
      summary: "Routine password reset request with no account-specific issue; the standard verified-email self-service reset flow applies.",
      evidence: [
        "Doc password-reset-guide describes the standard self-service reset flow",
        "Customer reports only a forgotten password; no defect or security concern mentioned",
      ],
      confidence: 0.9,
      policyReferences: [],
      flags: ["auto_resolvable"],
    }),
    response_agent_reply: JSON.stringify({
      body: "Sorry you're locked out — this is quick to fix yourself. Choose the password reset option on the sign-in page and enter the email address on your account; a reset link is sent to that address, and once you follow it and choose a new password you'll be able to sign in again. Let us know if you run into any trouble.",
      tone: "empathetic",
      nextSteps: ["Choose the password reset option on the sign-in page", "Follow the emailed link to choose a new password"],
    }),
  },

  "duplicate-billing": {
    ticket_classification: JSON.stringify({
      intent: "duplicate_charge",
      domains: ["billing", "policy"],
      sentiment: "frustrated",
      confidence: 0.92,
      summary: "Customer reports being charged twice for the same invoice.",
      keyEvidence: ["charged twice", "$399.00", "same day"],
    }),
    billing_agent_finding: JSON.stringify({
      agentKey: "billing",
      summary: "Confirmed two identical $399.00 charges on the same invoice within hours.",
      evidence: ["Two succeeded charges of $399.00 on the same invoice, ~10 hours apart"],
      confidence: 0.95,
      policyReferences: [],
      flags: ["duplicate_charge_confirmed"],
    }),
    policy_agent_finding: JSON.stringify({
      agentKey: "policy",
      summary: "Duplicate Charge Policy applies; the second charge qualifies for a full refund.",
      evidence: ["Same amount, same invoice, well within the 48-hour window"],
      confidence: 0.95,
      policyReferences: [{ slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" }],
      flags: [],
      policyDecision: {
        applicablePolicy: { slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" },
        decision: "approve",
        justification: "Two identical charges on the same invoice within 48 hours is a confirmed duplicate.",
        conditionsMet: ["same amount", "same invoice", "within 48 hours"],
        conditionsUnmet: [],
      },
    }),
    response_agent_reply: JSON.stringify({
      body: "We found the duplicate $399.00 charge on your account and have refunded it in full — it should appear on your statement within 5-10 business days.",
      tone: "empathetic",
      nextSteps: ["Refund processed", "Appears in 5-10 business days"],
    }),
  },

  "prohibited-refund": {
    ticket_classification: JSON.stringify({
      intent: "refund_request",
      domains: ["billing", "policy"],
      sentiment: "neutral",
      confidence: 0.9,
      summary: "Customer requests a refund for an annual plan charged 210 days ago with acknowledged daily usage.",
      keyEvidence: ["signed up... back in the spring", "using it daily since"],
    }),
    billing_agent_finding: JSON.stringify({
      agentKey: "billing",
      summary: "Single annual charge 210 days ago; no duplicate or payment issue.",
      evidence: ["One succeeded charge of $17,990.00, 210 days ago"],
      confidence: 0.9,
      policyReferences: [],
      flags: ["no_billing_issue_found"],
    }),
    policy_agent_finding: JSON.stringify({
      agentKey: "policy",
      summary: "Refund denied — charge occurred well outside the 14-day window, with acknowledged daily usage.",
      evidence: ["Days since most recent charge: 210", "Customer stated they have used the product daily since"],
      confidence: 0.92,
      policyReferences: [{ slug: "refund-policy", title: "Refund Policy" }],
      flags: [],
      policyDecision: {
        applicablePolicy: { slug: "refund-policy", title: "Refund Policy" },
        decision: "deny",
        justification: "Charge occurred 210 days ago with acknowledged daily usage — outside the 14-day, low-usage refund window.",
        conditionsMet: [],
        conditionsUnmet: ["within 14 days", "minimal usage"],
      },
    }),
    response_agent_reply: JSON.stringify({
      body: "I'm sorry, but this charge falls outside our 14-day refund window, and since the account has been in daily use since then, we're not able to issue a refund for the annual plan. Happy to help with a downgrade or cancellation for the next renewal instead.",
      tone: "apologetic",
      nextSteps: [],
    }),
  },

  "legitimate-refund": {
    ticket_classification: JSON.stringify({
      intent: "refund_request",
      domains: ["billing", "policy"],
      sentiment: "neutral",
      confidence: 0.9,
      summary: "Customer accidentally upgraded 5 days ago and has not used the new plan since.",
      keyEvidence: ["upgraded... by mistake 5 days ago", "haven't logged in since"],
    }),
    billing_agent_finding: JSON.stringify({
      agentKey: "billing",
      summary: "Single charge 5 days ago for the Growth upgrade; no other billing issues.",
      evidence: ["One succeeded charge of $297.00, 5 days ago"],
      confidence: 0.9,
      policyReferences: [],
      flags: ["no_billing_issue_found"],
    }),
    policy_agent_finding: JSON.stringify({
      agentKey: "policy",
      summary: "Refund approved — charge occurred 5 days ago, well within the window, with no usage since.",
      evidence: ["Days since most recent charge: 5", "Customer states no logins since the upgrade"],
      confidence: 0.93,
      policyReferences: [{ slug: "refund-policy", title: "Refund Policy" }],
      flags: [],
      policyDecision: {
        applicablePolicy: { slug: "refund-policy", title: "Refund Policy" },
        decision: "approve",
        justification: "Charge occurred 5 days ago with no usage since — squarely inside the refund window.",
        conditionsMet: ["within 14 days", "minimal usage"],
        conditionsUnmet: [],
      },
    }),
    response_agent_reply: JSON.stringify({
      body: "No problem — since this was within the last 5 days and the account hasn't been used since the upgrade, we've refunded the charge in full and reverted you to the Starter plan.",
      tone: "empathetic",
      nextSteps: ["Refund processed", "Plan reverted to Starter"],
    }),
  },

  "failed-payment": {
    ticket_classification: JSON.stringify({
      intent: "failed_payment",
      domains: ["billing"],
      sentiment: "neutral",
      confidence: 0.9,
      summary: "Card payment failed; customer says they already updated their card on file.",
      keyEvidence: ["payment failed", "already updated my card on file"],
    }),
    billing_agent_finding: JSON.stringify({
      agentKey: "billing",
      summary: "Most recent charge failed (insufficient funds); customer has already updated payment method.",
      evidence: ["Most recent failed charge: insufficient_funds, 3 days ago"],
      confidence: 0.88,
      policyReferences: [],
      flags: ["payment_failed_awaiting_customer_action"],
    }),
    response_agent_reply: JSON.stringify({
      body: "Thanks for updating your card. The next automatic retry will use the new card on file — we'll follow up if there's any further issue, but no action is needed from you right now.",
      tone: "neutral",
      nextSteps: ["Automatic retry will use the updated card"],
    }),
  },

  "known-technical-issue": {
    // DELIBERATELY WRONG — see the file header comment. The real ticket
    // clearly matches the documented large-board automation-timeout known
    // issue (technical_issue, expects [technical, response] ->
    // reply_and_close). This fixture instead misclassifies it as a
    // billing question and routes to Billing with a low-confidence,
    // no-issue-found finding, which resolveOutcome() correctly resolves
    // to "reply_and_monitor" — NOT the expected "reply_and_close". This
    // proves scoreOutcome() reports classificationCorrect=false,
    // routingCorrect=false, and resolutionCorrect=false through the real
    // runner + scorer, not just in an isolated unit test.
    ticket_classification: JSON.stringify({
      intent: "billing_question",
      domains: ["billing"],
      sentiment: "neutral",
      confidence: 0.6,
      summary: "Deliberately incorrect classification for evaluation dry-run regression coverage.",
      keyEvidence: ["INTENTIONAL MISCLASSIFICATION — see evaluationDryRunFixtures.ts"],
    }),
    billing_agent_finding: JSON.stringify({
      agentKey: "billing",
      summary: "No billing issue found on this account.",
      evidence: ["One succeeded charge, on schedule"],
      confidence: 0.3,
      policyReferences: [],
      flags: ["no_billing_issue_found"],
    }),
    response_agent_reply: JSON.stringify({
      body: "Thanks for reaching out — we're looking into this and will follow up shortly.",
      tone: "neutral",
      nextSteps: [],
    }),
  },

  "technical-escalation": {
    ticket_classification: JSON.stringify({
      intent: "technical_issue",
      domains: ["technical"],
      sentiment: "urgent",
      confidence: 0.9,
      summary: "Customer already tried the documented workaround (splitting the board) and automations are still broken.",
      keyEvidence: ["split the oversized board... exactly as your help article describes", "still not firing", "blocking our team's daily workflow"],
    }),
    technical_agent_finding: JSON.stringify({
      agentKey: "technical",
      summary: "Matches the known automation-timeout issue; the documented workaround was already tried and did not help.",
      evidence: ["Customer confirmed the board was already split into two", "Automations still not firing on either board"],
      confidence: 0.85,
      policyReferences: [],
      flags: ["known_issue_workaround_already_tried", "requires_escalation"],
    }),
    risk_agent_finding: JSON.stringify({
      agentKey: "risk",
      summary: "Documented workaround already failed; this needs Engineering, not another support attempt.",
      evidence: ["Technical Agent confirmed the workaround was tried and failed"],
      confidence: 0.85,
      policyReferences: [],
      flags: [],
      escalationRecommended: true,
      escalationReason: "Known issue's documented workaround already failed — needs Engineering investigation.",
      targetTeam: "engineering",
      severity: "medium",
    }),
    response_agent_reply: JSON.stringify({
      body: "I'm sorry this is still blocking your team. Since the standard workaround didn't resolve it, I've escalated this directly to our engineering team with your board details — you'll hear back with next steps shortly.",
      tone: "apologetic",
      nextSteps: ["Escalated to engineering"],
    }),
  },

  "suspicious-activity": {
    ticket_classification: JSON.stringify({
      intent: "account_security",
      domains: ["risk"],
      sentiment: "urgent",
      confidence: 0.93,
      summary: "Customer reports an unrecognized login and an API key they didn't create.",
      keyEvidence: ["unfamiliar location", "API key... none of us created"],
    }),
    risk_agent_finding: JSON.stringify({
      agentKey: "risk",
      summary: "Unrecognized login and API key strongly suggest account compromise.",
      evidence: ["Login from unfamiliar location in another country", "Unrecognized API key in account settings"],
      confidence: 0.95,
      policyReferences: [{ slug: "account-security-policy", title: "Account Security Policy" }],
      flags: [],
      escalationRecommended: true,
      escalationReason: "Suspected account compromise per Account Security Policy — must escalate to Trust & Safety.",
      targetTeam: "trust_and_safety",
      severity: "critical",
    }),
    response_agent_reply: JSON.stringify({
      body: "Thank you for flagging this immediately. We've escalated this to our security team for urgent investigation — for your protection we won't discuss further account details over this channel until identity is reverified. You'll hear from us shortly.",
      tone: "direct",
      nextSteps: ["Escalated to security team", "Identity will be reverified through a separate channel"],
    }),
  },

  "ambiguous-request": {
    ticket_classification: JSON.stringify({
      intent: "general_inquiry",
      domains: [],
      sentiment: "neutral",
      confidence: 0.35,
      summary: "Vague follow-up referencing an unspecified prior conversation with no other context.",
      keyEvidence: ["the thing we talked about"],
    }),
    response_agent_reply: JSON.stringify({
      body: "Happy to help — could you remind me which topic or ticket you're referring to? I want to make sure I get you the right answer.",
      tone: "neutral",
      nextSteps: ["Awaiting clarification from customer"],
    }),
  },

  "multi-domain": {
    ticket_classification: JSON.stringify({
      intent: "billing_question",
      domains: ["billing", "policy", "technical"],
      sentiment: "frustrated",
      confidence: 0.88,
      summary: "Automations broke and a proration charge was duplicated right after a plan upgrade.",
      keyEvidence: ["automations stopped running", "charged the $100 proration fee twice"],
    }),
    billing_agent_finding: JSON.stringify({
      agentKey: "billing",
      summary: "Confirmed two identical $100.00 proration charges on the same invoice.",
      evidence: ["Two succeeded charges of $100.00 on the same invoice, same day"],
      confidence: 0.93,
      policyReferences: [],
      flags: ["duplicate_charge_confirmed"],
    }),
    policy_agent_finding: JSON.stringify({
      agentKey: "policy",
      summary: "Duplicate Charge Policy applies to the proration charge; refund the duplicate in full.",
      evidence: ["Same amount, same invoice, within 48 hours"],
      confidence: 0.93,
      policyReferences: [{ slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" }],
      flags: [],
      policyDecision: {
        applicablePolicy: { slug: "duplicate-charge-policy", title: "Duplicate Charge Policy" },
        decision: "approve",
        justification: "Confirmed duplicate proration charge — refund the second charge in full.",
        conditionsMet: ["same amount", "same invoice", "within 48 hours"],
        conditionsUnmet: [],
      },
    }),
    technical_agent_finding: JSON.stringify({
      agentKey: "technical",
      summary: "Matches the known automation-timeout issue triggered by the plan change; workaround not yet tried.",
      evidence: ["Board automations stopped immediately after the upgrade"],
      confidence: 0.8,
      policyReferences: [],
      flags: ["known_issue_workaround_available"],
    }),
    response_agent_reply: JSON.stringify({
      body: "Two things here: first, we found the duplicate $100 proration charge and have refunded it in full. Second, for the automations issue, this matches a known limitation on large boards after a plan change — splitting the board into two smaller ones should restore automation delivery immediately.",
      tone: "empathetic",
      nextSteps: ["Duplicate charge refunded", "Split the affected board to restore automations"],
    }),
  },
};
