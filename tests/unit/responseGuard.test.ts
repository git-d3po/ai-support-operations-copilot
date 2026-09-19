import { describe, expect, it } from "vitest";
import {
  authorizedCommitmentsInstruction,
  customerResponseSchemaFor,
  findUnauthorizedRefundPromise,
} from "@/lib/orchestrator/responseGuard";

// The exact customer reply the real model produced in the first live smoke
// test (duplicate-billing), under a reply_and_close resolution.
const LIVE_SMOKE_TEST_RESPONSE = {
  subject: "Duplicate Charge Confirmed - Refund Being Processed",
  body: "Thanks for flagging this, and sorry for the inconvenience. We took a close look at your account and confirmed that invoice INV-39ESYJ-1 for your Scale plan was indeed charged twice on 2026-09-15, both for $399.00. This was a duplicate charge, and we're processing a refund for one of the two transactions now. You should see the refund reflected on your original payment method within 5-10 business days, depending on your bank's processing times.",
  nextSteps: [
    "Refund of $399.00 for the duplicate charge is being processed",
    "Reach out if the refund hasn't appeared after that window so we can follow up",
  ],
  tone: "apologetic" as const,
};

describe("findUnauthorizedRefundPromise", () => {
  it("flags the real live-run reply when the resolution is reply_and_close", () => {
    expect(findUnauthorizedRefundPromise(LIVE_SMOKE_TEST_RESPONSE, "reply_and_close")).not.toBeNull();
  });

  it("flags it for every non-refund action", () => {
    for (const action of ["reply_and_close", "reply_and_monitor", "escalate", "deny_request", "auto_resolve"] as const) {
      expect(findUnauthorizedRefundPromise(LIVE_SMOKE_TEST_RESPONSE, action)).not.toBeNull();
    }
  });

  it("allows the same reply when the resolution authorizes a refund", () => {
    expect(findUnauthorizedRefundPromise(LIVE_SMOKE_TEST_RESPONSE, "refund_customer")).toBeNull();
  });

  it.each([
    ["body", { body: "We have issued a refund to your card." }],
    ["body, refunding", { body: "We're refunding the second charge today." }],
    ["body, will be", { body: "A refund will be credited within 5 business days." }],
    ["subject", { subject: "Your refund is on its way", body: "Thanks for your patience." }],
    ["nextSteps", { body: "Thanks for writing in.", nextSteps: ["Your refund is being processed"] }],
  ])("flags a refund promise in the %s", (_label, response) => {
    expect(findUnauthorizedRefundPromise(response, "reply_and_close")).not.toBeNull();
  });

  it.each([
    "Unfortunately we can't offer a refund for this charge, as it falls outside our 14-day refund window.",
    "This charge is not eligible for a refund under our policy.",
    "Under our policy, refunds are only issued within 14 days of the charge.",
    "If the review confirms the charge was a mistake, we'll process a refund.",
    "We're reviewing your refund request and a specialist will follow up shortly.",
    "Thanks for your refund request — we've passed it to the right team.",
    "Your payment failed and will be retried automatically on Friday.",
  ])("does not flag legitimate non-promise wording: %s", (body) => {
    expect(findUnauthorizedRefundPromise({ body, nextSteps: [] }, "deny_request")).toBeNull();
  });
});

describe("customerResponseSchemaFor", () => {
  it("rejects an over-promising reply with an actionable message that names the action", () => {
    const parsed = customerResponseSchemaFor("reply_and_close").safeParse(LIVE_SMOKE_TEST_RESPONSE);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toMatch(/reply_and_close.*does not authorize/);
    }
  });

  it("accepts the same reply under refund_customer", () => {
    expect(customerResponseSchemaFor("refund_customer").safeParse(LIVE_SMOKE_TEST_RESPONSE).success).toBe(true);
  });

  it("still enforces the base CustomerResponse shape", () => {
    expect(customerResponseSchemaFor("refund_customer").safeParse({ body: "hi" }).success).toBe(false);
  });
});

describe("authorizedCommitmentsInstruction", () => {
  it("authorizes a refund only for refund_customer", () => {
    expect(authorizedCommitmentsInstruction("refund_customer")).toMatch(/IS authorized/);
    expect(authorizedCommitmentsInstruction("reply_and_close")).toMatch(/NO refund is authorized/);
    expect(authorizedCommitmentsInstruction("escalate")).toMatch(/NO refund is authorized/);
  });
});
