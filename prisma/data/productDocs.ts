export interface ProductDocSeed {
  slug: string;
  title: string;
  product: string;
  version: string;
  body: string;
}

/**
 * Synthetic product documentation / knowledge-base articles. The Technical
 * Agent grounds its diagnoses in these — in particular
 * `known-issue-automation-timeout`, which several curated evaluation
 * tickets reference (see prisma/data/scenarios.ts).
 */
export const PRODUCT_DOCS: ProductDocSeed[] = [
  {
    slug: "known-issue-automation-timeout",
    title: "Known Issue: Automations Time Out on Large Boards",
    product: "core",
    version: "1.0",
    body: `# Known Issue: Automations Time Out on Large Boards

**Status: Known, workaround available. Tracked as ENG-4821.**

Automations attached to boards with more than 2,000 cards can silently stop
firing after a plan change or a bulk import, because the automation
indexer's queue times out before finishing the reindex.

**Workaround:** Splitting the board into two boards under 2,000 cards each
restores automation delivery immediately. A permanent fix (raising the
reindex timeout) is scheduled but not yet shipped.

**When to escalate instead of using the workaround:** if the customer has
already split the board (or cannot, for structural reasons) and automations
are still not firing, escalate to Engineering with the board ID and card
count.`,
  },
  {
    slug: "troubleshooting-webhook-failures",
    title: "Troubleshooting Webhook Delivery Failures",
    product: "core",
    version: "1.2",
    body: `# Troubleshooting Webhook Delivery Failures

Webhook automations fail delivery for one of three reasons:

1. The destination endpoint returned a non-2xx response (check the
   automation's delivery log for the status code).
2. The destination endpoint didn't respond within 10 seconds.
3. The webhook secret was rotated and the destination is still validating
   against the old signature.

Halcyon retries failed webhook deliveries 3 times with exponential backoff,
then marks the automation run as failed. This is expected behavior, not a
product defect, unless deliveries are failing with a 2xx response recorded
in the log (which would indicate a bug worth escalating).`,
  },
  {
    slug: "sso-saml-setup-guide",
    title: "Setting Up SSO / SAML",
    product: "SSO-ADDON",
    version: "1.0",
    body: `# Setting Up SSO / SAML

SSO is available on the SSO / SAML add-on. Setup requires an account admin
to upload their identity provider's metadata XML under
Settings → Security → SSO. Propagation to all workspace members takes up to
15 minutes after activation.

Common setup issues are almost always a mismatched Entity ID or ACS URL
between Halcyon and the identity provider, not a Halcyon-side defect.`,
  },
  {
    slug: "api-rate-limits",
    title: "API Rate Limits",
    product: "API-USAGE",
    version: "1.1",
    body: `# API Rate Limits

The core API allows 300 requests/minute per API key on Growth and above,
and 60 requests/minute on Starter. Requests beyond the limit receive a 429
response with a \`Retry-After\` header. Usage beyond the plan's included
monthly quota is billed under the API-USAGE product, not blocked.`,
  },
  {
    slug: "billing-invoices-faq",
    title: "Invoices & Billing FAQ",
    product: "core",
    version: "1.0",
    body: `# Invoices & Billing FAQ

Invoices are generated at the start of each billing period and charged to
the account's default payment method within 24 hours. A failed charge is
retried on days 1, 3, and 7 after the original attempt before the
subscription is marked past due.`,
  },
  {
    slug: "security-2fa-setup",
    title: "Setting Up Two-Factor Authentication",
    product: "core",
    version: "1.0",
    body: `# Setting Up Two-Factor Authentication

Two-factor authentication can be enabled per-user under Settings → Security.
Account admins can require 2FA for all workspace members. Losing access to
a 2FA device requires identity verification through a secondary channel
before it can be reset — this cannot be done from a support ticket alone.`,
  },
];
