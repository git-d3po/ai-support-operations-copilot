import { DEFAULT_MODEL_ROUTING } from "../modelRouting";
import type { SpecialistAgent } from "../types";
import { stubAgentResult } from "./stub";

/** Determines which policy governs a request (refunds, cancellations, etc.)
 * and whether the request meets that policy's conditions. */
export const policyAgent: SpecialistAgent = {
  key: "policy",
  description:
    "Matches the ticket against company policy documents and evaluates whether conditions are met.",
  async run(context) {
    return stubAgentResult("policy", context, DEFAULT_MODEL_ROUTING.policy.model);
  },
};
