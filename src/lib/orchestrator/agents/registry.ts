import type { AgentKey } from "@/lib/ai/schemas";
import type { SpecialistAgent } from "../types";
import { billingAgent } from "./billingAgent";
import { policyAgent } from "./policyAgent";
import { technicalAgent } from "./technicalAgent";
import { riskAgent } from "./riskAgent";
import { responseAgent } from "./responseAgent";

export const AGENT_REGISTRY: Record<AgentKey, SpecialistAgent> = {
  billing: billingAgent,
  policy: policyAgent,
  technical: technicalAgent,
  risk: riskAgent,
  response: responseAgent,
};
