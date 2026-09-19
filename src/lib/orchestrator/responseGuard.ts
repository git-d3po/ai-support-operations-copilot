import { CustomerResponseSchema, type ResolutionDecision } from "@/lib/ai/schemas";

/**
 * Enforces the resolution → Response contract: the customer reply may only
 * promise a refund when the persisted resolution actually authorizes one
 * (`action === "refund_customer"`, which resolveOutcome() emits solely from
 * a grounded Policy "approve"). A prompt instruction alone isn't enough —
 * the first live smoke test showed the Response agent telling a customer a
 * refund was "being processed" under a `reply_and_close` resolution — so
 * the check is deterministic code on the output, wired into the existing
 * validate → retry-with-feedback → safe-fallback path (see
 * responseAgent.ts). See DECISIONS.md.
 *
 * It is a conservative, sentence-level heuristic, not a language
 * understanding system: it flags a sentence that mentions a refund AND uses
 * a commitment verb ("processed", "issued", "refunding", "credited"…) AND
 * contains no negation or conditional ("can't", "not", "if", "only"…). A
 * false positive costs one retry and, at worst, the generic fallback reply
 * (safe, and visible to the operator); a false negative is the failure this
 * exists to prevent, so it errs toward flagging.
 */
const REFUND_TERM = /\b(refund\w*|reimburs\w*|money back)\b/i;
const NEGATION_OR_CONDITIONAL =
  /\b(not|no|never|unable|unfortunately|cannot|only|if|unless|whether|would|could|may|might)\b|n['’]t\b/i;
const COMMITMENT =
  /\b(process\w*|issu\w*|initiat\w*|sent|send\w*|return\w*|credit\w*|approv\w*|grant\w*|refunded|refunding|reflected|reimbursed|on (?:its|the) way)\b/i;

function segments(response: { subject?: string; body: string; nextSteps: string[] }): string[] {
  const parts = [response.subject ?? "", response.body, ...response.nextSteps];
  return parts.flatMap((part) => part.split(/(?<=[.!?])\s+|\n+| [-–—] /)).filter((s) => s.trim().length > 0);
}

/** The first sentence that promises a refund, or null if none does — or if
 * the resolution authorizes a refund, in which case nothing is restricted. */
export function findUnauthorizedRefundPromise(
  response: { subject?: string; body: string; nextSteps?: string[] },
  action: ResolutionDecision["action"],
): string | null {
  if (action === "refund_customer") return null;
  const candidates = segments({ ...response, nextSteps: response.nextSteps ?? [] });
  return (
    candidates.find(
      (s) => REFUND_TERM.test(s) && COMMITMENT.test(s) && !NEGATION_OR_CONDITIONAL.test(s),
    ) ?? null
  );
}

/** CustomerResponseSchema plus the refund-authorization contract for a
 * specific resolution. A violation is an ordinary validation failure, so
 * runStructuredStep retries once with the message fed back, then returns
 * null → the Response agent's safe fallback. */
export function customerResponseSchemaFor(action: ResolutionDecision["action"]) {
  return CustomerResponseSchema.superRefine((response, ctx) => {
    const offending = findUnauthorizedRefundPromise(response, action);
    if (offending) {
      ctx.addIssue({
        code: "custom",
        path: ["body"],
        message: `promises a refund, but the resolution action is "${action}", which does not authorize one. Remove any statement that a refund has been, is being, or will be issued or processed (offending text: "${offending}")`,
      });
    }
  });
}

/** The commitment rules stated to the Response agent — derived from the
 * resolution, not chosen by the model. */
export function authorizedCommitmentsInstruction(action: ResolutionDecision["action"]): string {
  return action === "refund_customer"
    ? "Authorized commitments: a refund IS authorized by the resolution — you may confirm it clearly."
    : `Authorized commitments: NO refund is authorized (resolution action is "${action}"). Do NOT say or imply that a refund has been, is being, or will be issued, processed, or credited. You may acknowledge the customer's request and describe only what the resolution actually says will happen.`;
}
