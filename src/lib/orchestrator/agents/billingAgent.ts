import { DEFAULT_MODEL_ROUTING } from "../modelRouting";
import type { SpecialistAgent } from "../types";
import { stubAgentResult } from "./stub";

/** Reasons about charges, invoices, payment failures, and duplicate billing. */
export const billingAgent: SpecialistAgent = {
  key: "billing",
  description:
    "Reviews invoices, transactions, and subscription history for billing-related tickets.",
  async run(context) {
    return stubAgentResult("billing", context, DEFAULT_MODEL_ROUTING.billing.model);
  },
};
