import { isPolicyFinding, type AnyAgentFinding, type PolicyReference } from "@/lib/ai/schemas";

/**
 * The policies a run's findings cite, for the ticket page's Recommendation
 * panel ("Policy cited"). Only the two agents that are shown policies and whose
 * citations are grounding-enforced count: the Policy Agent (its decision's
 * `applicablePolicy` first, then its `policyReferences`) and the Risk /
 * Escalation Agent (its `policyReferences`). Billing and Technical are never
 * shown a policy and always store no citations (DECISIONS.md, "Billing and
 * Technical do not parse policy citations"), so their findings are ignored even
 * if one ever held a non-empty list. Nothing is inferred from prose, and product
 * documentation is never a citation.
 *
 * Deduplicated by slug, in a fixed order (Policy before Risk) rather than the
 * steps' stored order, whose timestamps are approximate (TODO.md). An empty
 * result means nothing was cited, and the panel then omits the fact.
 */
export function citedPolicies(steps: { agentKey: string; finding: unknown }[]): PolicyReference[] {
  const cited = new Map<string, PolicyReference>();
  const cite = (reference: PolicyReference) => {
    if (!cited.has(reference.slug)) cited.set(reference.slug, reference);
  };
  const findingsOf = (agentKey: "policy" | "risk") =>
    steps.filter((step) => step.agentKey === agentKey && step.finding != null).map((step) => step.finding as AnyAgentFinding);

  for (const finding of findingsOf("policy")) {
    if (isPolicyFinding(finding) && finding.policyDecision) cite(finding.policyDecision.applicablePolicy);
    finding.policyReferences.forEach(cite);
  }
  for (const finding of findingsOf("risk")) finding.policyReferences.forEach(cite);

  return [...cited.values()];
}
