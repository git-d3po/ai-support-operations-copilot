import { DEFAULT_MODEL_ROUTING } from "../modelRouting";
import type { SpecialistAgent } from "../types";
import { stubAgentResult } from "./stub";

/** Flags account security concerns, churn risk, and abuse patterns that may
 * require escalation regardless of what other agents conclude. */
export const riskAgent: SpecialistAgent = {
  key: "risk",
  description:
    "Assesses security, fraud, and churn risk signals and recommends escalation when warranted.",
  async run(context) {
    return stubAgentResult("risk", context, DEFAULT_MODEL_ROUTING.risk.model);
  },
};
