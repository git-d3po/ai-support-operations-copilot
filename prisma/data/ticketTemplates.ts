import type { TicketIntent } from "@/lib/ai/schemas";

/**
 * Lightweight templates used only to generate believable *background*
 * inbox volume (ordinary tickets with no evaluation stake). The 11 curated
 * scenarios in scenarios.ts are hand-authored instead, because those are
 * the ones the evaluation suite scores correctness against.
 */
export interface TicketTemplate {
  subject: string;
  customerBody: string;
  agentBody: string;
}

export const TICKET_TEMPLATES: Record<TicketIntent, TicketTemplate[]> = {
  password_reset: [
    {
      subject: "Can't remember my password",
      customerBody: "I'm locked out of my account and the reset email isn't showing up. Can you help?",
      agentBody: "I've triggered a fresh reset email to your address on file — it should arrive within a few minutes. Let me know if it doesn't come through.",
    },
    {
      subject: "Locked out after changing my email",
      customerBody: "I updated my email address and now I can't log in with either the old or new one.",
      agentBody: "I've re-verified your new email on the account and sent a password reset link there. You should be able to log in going forward.",
    },
  ],
  duplicate_charge: [
    {
      subject: "Looks like we were charged twice",
      customerBody: "Two charges for the same amount showed up on our card statement this week. Can you take a look?",
      agentBody: "You're right, I can see two charges tied to the same invoice. I've refunded the duplicate — you should see it back on your statement in 5-10 business days.",
    },
  ],
  refund_request: [
    {
      subject: "Requesting a refund",
      customerBody: "We'd like a refund for this billing period, we're switching tools.",
      agentBody: "I've reviewed the account and processed the refund per our policy. You're welcome back any time.",
    },
    {
      subject: "Partial refund for unused seats",
      customerBody: "We removed several seats mid-cycle, is there a partial refund for the unused time?",
      agentBody: "Seat changes take effect at the next renewal rather than a mid-cycle refund, per our billing terms — I've confirmed your seat count is already updated for next cycle.",
    },
  ],
  failed_payment: [
    {
      subject: "Payment failed notice",
      customerBody: "We got an email saying our payment failed. Not sure why, our card should be valid.",
      agentBody: "The charge was declined by your bank as a soft decline. I'd recommend updating the card on file so the next automatic retry succeeds.",
    },
  ],
  billing_question: [
    {
      subject: "Question about a line item on our invoice",
      customerBody: "There's a line item on our latest invoice we don't recognize. Can you explain it?",
      agentBody: "That line item is metered API usage beyond your plan's included quota for the month — I've attached a breakdown of the calls that contributed to it.",
    },
    {
      subject: "When do usage charges get billed?",
      customerBody: "Do API overage charges bill immediately or on the next invoice?",
      agentBody: "Usage charges accrue throughout the period and bill on your next regular invoice, not immediately.",
    },
  ],
  technical_issue: [
    {
      subject: "Slack integration not posting updates",
      customerBody: "Our Slack integration stopped posting automation updates a couple of days ago.",
      agentBody: "I found the delivery failures in the automation log — the Slack webhook URL had expired. I've walked you through regenerating it via email.",
    },
    {
      subject: "Dashboard loading slowly",
      customerBody: "Our analytics dashboard has been taking 10+ seconds to load lately.",
      agentBody: "This looks tied to one particularly large report — I've suggested narrowing its date range, which should bring load times back down.",
    },
  ],
  account_security: [
    {
      subject: "Enabling SSO for our team",
      customerBody: "We're ready to turn on SSO for everyone. What do we need from our identity provider?",
      agentBody: "You'll need your identity provider's metadata XML uploaded under Settings → Security → SSO — I've linked the setup guide with the exact steps.",
    },
  ],
  cancellation: [
    {
      subject: "Cancelling our subscription",
      customerBody: "We'd like to cancel our subscription at the end of this billing period.",
      agentBody: "I've scheduled the cancellation to take effect at the end of your current billing period, with no early termination fee.",
    },
  ],
  feature_question: [
    {
      subject: "Does Halcyon support recurring automations?",
      customerBody: "Can automations be scheduled to run on a recurring basis, or only trigger-based?",
      agentBody: "Recurring, schedule-based automations are supported on Growth and above — I've included a quick guide on setting one up.",
    },
  ],
  general_inquiry: [
    {
      subject: "Checking in on our account",
      customerBody: "Just wanted to check that everything on our account looks good after our recent plan change.",
      agentBody: "Everything looks correct on our end — your plan, seats, and billing are all up to date.",
    },
  ],
};
