export interface PolicySeed {
  slug: string;
  title: string;
  category: "billing" | "refunds" | "security" | "technical" | "escalation";
  version: string;
  body: string;
}

/**
 * Synthetic company policy documents. These are what the Policy Agent
 * grounds its decisions in — every PolicyDecision the agent produces must
 * cite one of these by slug (see AgentFinding.policyReferences).
 */
export const POLICIES: PolicySeed[] = [
  {
    slug: "refund-policy",
    title: "Refund Policy",
    category: "refunds",
    version: "2.3",
    body: `# Refund Policy

Halcyon issues refunds under the following conditions:

1. **Within 14 days of a charge**, for annual or monthly subscription charges,
   if the customer has not meaningfully used the plan tier they are
   requesting a refund for (fewer than 5 login sessions since the charge).
2. **Duplicate charges** are always refunded in full, regardless of usage or
   timing, once confirmed as duplicate (see Duplicate Charge Policy).
3. **Usage-based charges** (API overages, storage overages) are non-refundable
   once the usage has occurred, because the underlying resource was consumed.
4. **Downgrades mid-cycle** are not refunded for the current billing period;
   the downgrade takes effect at the next renewal.

Refund requests outside these conditions require Billing Ops approval and
should be marked \`requires_review\` rather than auto-denied, unless the
request is clearly outside condition 1 by more than 90 days, in which case
it may be denied directly with an explanation.`,
  },
  {
    slug: "duplicate-charge-policy",
    title: "Duplicate Charge Policy",
    category: "billing",
    version: "1.4",
    body: `# Duplicate Charge Policy

A charge is considered a duplicate when two transactions on the same account
have the same amount, the same invoice or subscription, and occur within 48
hours of each other, with no corresponding change in subscription quantity
or plan.

Confirmed duplicate charges are refunded in full without requiring the
customer to provide additional proof beyond the transaction history already
on the account. This is a fast-path resolution — it should not be escalated
unless the account also shows signs of broader billing-system failure
(3 or more duplicate pairs in the same billing period).`,
  },
  {
    slug: "cancellation-policy",
    title: "Cancellation Policy",
    category: "billing",
    version: "1.2",
    body: `# Cancellation Policy

Customers may cancel at any time. Cancellation takes effect at the end of
the current billing period; there is no early-termination fee.

Because cancellation requests are a churn signal, the Risk Agent should
always review cancellation tickets alongside the Policy Agent, so any
underlying dissatisfaction (unresolved technical issues, billing disputes)
is visible before the account is let go.`,
  },
  {
    slug: "account-security-policy",
    title: "Account Security Policy",
    category: "security",
    version: "3.0",
    body: `# Account Security Policy

Password reset requests are handled automatically via the standard
verified-email reset flow and do not require human review unless the
account has an open security flag.

Reports of suspicious account activity (logins from unrecognized locations,
unexpected permission changes, unrecognized API keys) must always be
escalated to Trust & Safety. Support operators should not attempt to
resolve these directly, and should not disclose account details until
identity is reverified through a channel other than the one the request
came in on.`,
  },
  {
    slug: "escalation-policy",
    title: "Escalation Policy",
    category: "escalation",
    version: "2.0",
    body: `# Escalation Policy

Escalate to:

- **Trust & Safety** — any suspected account compromise, credential sharing
  abuse, or fraud signal.
- **Engineering** — technical issues that match a known issue with no
  available workaround, or a new technical issue with reproducible
  evidence of a product defect affecting multiple accounts.
- **Billing Ops** — refund requests outside the standard Refund Policy
  conditions, or disputes where the account's transaction history is
  ambiguous or contradictory.
- **Senior Support** — any ticket where the customer sentiment is angry and
  the standard resolution path has already failed once, or where multiple
  domains (billing + technical, or billing + security) are involved and no
  single policy clearly governs the outcome.

Escalations must include the specific reason and the evidence that
triggered them; "unclear" is not an acceptable escalation reason.`,
  },
  {
    slug: "sla-support-policy",
    title: "Support SLA Policy",
    category: "technical",
    version: "1.1",
    body: `# Support SLA Policy

First response targets by plan:

| Plan       | First response |
|------------|----------------|
| Starter    | 24 business hours |
| Growth     | 12 business hours |
| Scale      | 4 business hours |
| Enterprise | 1 hour (or per contract) |

Accounts with the Priority Support add-on receive a 4-hour first response
regardless of plan tier.`,
  },
];
