/**
 * Scripted model responses for the 11 curated scenarios: the single source of
 * truth for BOTH public Demo Mode (`DemoProvider`) and the evaluation dry-run
 * harness (`scripts/evaluationDryRunFixtures.ts`). Data only.
 *
 * What these are: hand-authored structured outputs that are correct for each
 * scenario BY CONSTRUCTION (a test scores every one through the real
 * orchestrator and scorer). They are not model output and not evidence of how
 * any model performs; how a real model performs is what a live evaluation
 * measures. Demo Mode always labels them "scripted replay".
 *
 * Shape: `DEMO_RECORDINGS[scenarioKey] = { subject, responses }`, where
 * `responses[task]` is the JSON text a model would return for that pipeline
 * step (`ticket_classification`, `billing_agent_finding`, ...). Only the tasks
 * a scenario's expected agents actually call are recorded. `subject` is the
 * ticket's subject line, which is how the provider recognizes the ticket from
 * the prompt; a test keeps it equal to the curated scenario's subject.
 *
 * The harness's deliberately WRONG `known-technical-issue` answer (it exists
 * to prove the scorer detects a failure) is intentionally NOT here; it lives
 * in the harness only, layered over these recordings. See DECISIONS.md
 * ("Public Demo Mode").
 */

export interface DemoRecording {
  /** The curated ticket's subject line (used to recognize it in a prompt). */
  subject: string;
  /** Pipeline task name -> the JSON text the step's model would return. */
  responses: Record<string, string>;
}

export const DEMO_RECORDINGS: Record<string, DemoRecording> = {
  "password-reset": {
    subject: "Forgot my password \u2014 can't log in",
    responses: {
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
  },
  "duplicate-billing": {
    subject: "Charged twice this billing cycle",
    responses: {
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
        summary: "Confirmed two identical $399.00 charges on the same invoice on the same day.",
        evidence: ["Two succeeded charges of $399.00 on the same invoice, 0 hours apart"],
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
  },
  "prohibited-refund": {
    subject: "Refund request for API overage charges",
    responses: {
      ticket_classification: JSON.stringify({
        intent: "refund_request",
        domains: ["billing", "policy"],
        sentiment: "neutral",
        confidence: 0.9,
        summary: "Customer requests a refund of metered API overage charges caused by their own batch job.",
        keyEvidence: ["metered API overage charges", "a batch job we ran ourselves", "the usage was real"],
      }),
      billing_agent_finding: JSON.stringify({
        agentKey: "billing",
        summary: "Single succeeded charge of $2,450.00 tagged api_overage, 21 days ago; no duplicate or payment issue.",
        evidence: ["One succeeded charge of $2,450.00 (reason: api_overage), 21 days ago"],
        confidence: 0.9,
        policyReferences: [],
        flags: ["no_billing_issue_found"],
      }),
      policy_agent_finding: JSON.stringify({
        agentKey: "policy",
        summary: "Refund denied: API overage is a usage-based charge, non-refundable once the usage has occurred (Refund Policy condition 3).",
        evidence: [
          "Charge reason: api_overage (usage-based)",
          "Customer states the usage was real and came from their own batch job",
          "Days since most recent charge: 21",
        ],
        confidence: 0.92,
        policyReferences: [{ slug: "refund-policy", title: "Refund Policy" }],
        flags: [],
        policyDecision: {
          applicablePolicy: { slug: "refund-policy", title: "Refund Policy" },
          decision: "deny",
          justification: "Usage-based charges (API overages) are non-refundable once the usage has occurred, and the customer confirms it did.",
          conditionsMet: ["charge is usage-based (API overage)", "the usage has occurred"],
          conditionsUnmet: [],
        },
      }),
      response_agent_reply: JSON.stringify({
        body: "Thanks for reaching out, and I understand the overage was unexpected. Unfortunately, metered API overage charges are non-refundable once the usage has occurred, because the underlying resource was consumed, so we're not able to refund them. We're happy to help you review your API usage going forward.",
        tone: "apologetic",
        nextSteps: [],
      }),
    },
  },
  "legitimate-refund": {
    subject: "Refund request \u2014 upgraded by mistake",
    responses: {
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
  },
  "failed-payment": {
    subject: "Payment failed \u2014 updated my card, please retry",
    responses: {
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
  },
  "known-technical-issue": {
    subject: "Automations stopped firing right after our upgrade",
    responses: {
      ticket_classification: JSON.stringify({
        intent: "technical_issue",
        domains: ["technical"],
        sentiment: "frustrated",
        confidence: 0.93,
        summary: "Automations on the main board stopped after a plan upgrade; the board has about 2,500 cards.",
        keyEvidence: ["none of the automations on our main board are running", "upgraded to Scale two days ago", "around 2,500 cards"],
      }),
      technical_agent_finding: JSON.stringify({
        agentKey: "technical",
        summary: "Matches known issue ENG-4821: automations stop firing on boards over 2,000 cards after a plan change; the documented workaround (split the board) has not been tried.",
        evidence: [
          "Known Issue: Automations Time Out on Large Boards (ENG-4821)",
          "The customer's board has about 2,500 cards, above the 2,000-card threshold",
          "Automations stopped right after a plan upgrade, the documented trigger",
          "Nothing indicates the customer has already split the board",
        ],
        confidence: 0.9,
        policyReferences: [],
        flags: ["known_issue_workaround_available"],
      }),
      response_agent_reply: JSON.stringify({
        body: "Thanks for the details, and sorry for the disruption to your automations. What you describe matches a known issue: automations on boards with more than 2,000 cards can stop firing after a plan change. The documented workaround is to split the board into two boards under 2,000 cards each, which restores automation delivery. If automations are still not firing after that, reply here with the board ID and card count and we will escalate to Engineering.",
        tone: "empathetic",
        nextSteps: ["Split the board into two boards under 2,000 cards each", "Reply with the board ID and card count if automations still do not fire"],
      }),
    },
  },
  "technical-escalation": {
    subject: "Automations still broken after splitting the board like support suggested",
    responses: {
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
  },
  "suspicious-activity": {
    subject: "Unrecognized login and API key on our account",
    responses: {
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
  },
  "ambiguous-request": {
    subject: "question",
    responses: {
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
  },
  "multi-domain": {
    subject: "Double charged on upgrade, and automations broke at the same time",
    responses: {
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
  },
  "out-of-window-refund": {
    subject: "Refund request for annual subscription charge",
    responses: {
      ticket_classification: JSON.stringify({
        intent: "refund_request",
        domains: ["billing", "policy"],
        sentiment: "neutral",
        confidence: 0.9,
        summary: "Customer requests a refund of an annual Growth subscription renewal charge paid 45 days ago.",
        keyEvidence: ["annual Growth subscription renewed 45 days ago", "$3,564.00 renewal charge", "request a refund of that charge"],
      }),
      billing_agent_finding: JSON.stringify({
        agentKey: "billing",
        summary: "Single succeeded subscription charge of $3,564.00, 45 days ago; no duplicate or payment issue.",
        evidence: ["One succeeded charge of $3,564.00, 45 days ago", "Automated duplicate-charge analysis: no duplicates"],
        confidence: 0.9,
        policyReferences: [],
        flags: ["no_billing_issue_found"],
      }),
      policy_agent_finding: JSON.stringify({
        agentKey: "policy",
        summary: "Charge is outside the 14-day condition and matches no other explicit condition; needs Billing Ops review, not an automatic denial.",
        evidence: [
          "Days since most recent charge: 45",
          "Ordinary subscription charge: not a duplicate, not usage-based, no downgrade mentioned",
        ],
        confidence: 0.9,
        policyReferences: [{ slug: "refund-policy", title: "Refund Policy" }],
        flags: [],
        policyDecision: {
          applicablePolicy: { slug: "refund-policy", title: "Refund Policy" },
          decision: "requires_review",
          justification:
            "The charge is 45 days old, outside the 14-day condition, and no other explicit condition applies; the Refund Policy requires Billing Ops approval and says to mark it requires_review rather than auto-deny.",
          conditionsMet: [],
          conditionsUnmet: ["within 14 days of the charge"],
        },
      }),
      response_agent_reply: JSON.stringify({
        body: "Thanks for getting in touch. Because this charge is outside our standard 14-day window, I can't decide it directly, so I've passed your request to our Billing Operations team for review. They'll follow up with you once they've looked at the details.",
        tone: "neutral",
        nextSteps: ["Billing Operations will review the request and follow up"],
      }),
    },
  },
};

const BY_SUBJECT = new Map(Object.entries(DEMO_RECORDINGS).map(([scenarioKey, recording]) => [recording.subject, { scenarioKey, recording }]));

/** Shown when Demo Mode is asked to analyze a ticket that has no scripted recording. */
export const DEMO_CURATED_ONLY_MESSAGE = "Demo Mode is available for the curated evaluation scenarios only.";

/** True when this curated scenario has a scripted recording (Demo Mode can run it). */
export function hasDemoRecording(scenarioKey: string | null | undefined): boolean {
  return !!scenarioKey && Object.prototype.hasOwnProperty.call(DEMO_RECORDINGS, scenarioKey);
}

/** Recognize a curated ticket from its subject line; null when it is not recorded. */
export function findDemoRecordingBySubject(subject: string): { scenarioKey: string; recording: DemoRecording } | null {
  return BY_SUBJECT.get(subject.trim()) ?? null;
}
