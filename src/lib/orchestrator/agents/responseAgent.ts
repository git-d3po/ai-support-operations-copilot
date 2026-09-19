import { DEFAULT_MODEL_ROUTING } from "../modelRouting";
import type { SpecialistAgent } from "../types";
import { stubAgentResult } from "./stub";

/** Drafts the customer-facing reply from the other agents' findings and the
 * orchestrator's resolution decision. Always runs last. */
export const responseAgent: SpecialistAgent = {
  key: "response",
  description:
    "Drafts the proposed customer response from the other agents' findings and the resolution decision.",
  async run(context) {
    return stubAgentResult("response", context, DEFAULT_MODEL_ROUTING.response.model);
  },
};
