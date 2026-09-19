import { DEFAULT_MODEL_ROUTING } from "../modelRouting";
import type { SpecialistAgent } from "../types";
import { stubAgentResult } from "./stub";

/** Diagnoses technical issues against known product documentation and
 * known-issue records. */
export const technicalAgent: SpecialistAgent = {
  key: "technical",
  description:
    "Diagnoses technical issues using product documentation and known-issue history.",
  async run(context) {
    return stubAgentResult("technical", context, DEFAULT_MODEL_ROUTING.technical.model);
  },
};
