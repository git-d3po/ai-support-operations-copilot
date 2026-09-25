import type { Metadata } from "next";
import { getAiMode } from "@/lib/ai/mode";
import { labelAgent } from "@/lib/labels";
import { DEFAULT_MODEL_ROUTING } from "@/lib/orchestrator/modelRouting";
import { AGENT_REGISTRY } from "@/lib/orchestrator/agents/registry";
import { TableScroll } from "@/components/ui/TableScroll";
import type { AgentKey } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Model Routing" };

/** The classifier is not a specialist agent, so it has no registry description of its own. */
const CLASSIFIER_DESCRIPTION = "Classifies the ticket's intent before any specialist is selected.";

function describeStep(stepKey: string): string | null {
  if (stepKey === "classifier") return CLASSIFIER_DESCRIPTION;
  return AGENT_REGISTRY[stepKey as AgentKey]?.description ?? null;
}

export default function SettingsPage() {
  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-lg font-semibold">Model Routing</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        The provider and model that serve each pipeline step, and the per-token prices used to estimate
        cost on AI Operations. Each step is routed independently, so one step can move to a different model
        or provider without affecting the others. Routing is set in the application&apos;s configuration and
        is read-only here.
        {getAiMode() === "demo" && " In Demo Mode none of these models is called: every step is a scripted replay."}
      </p>

      <TableScroll className="mt-4 max-w-3xl">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-4">Pipeline step</th>
              <th className="py-2 pr-4">Provider</th>
              <th className="py-2 pr-4">Model</th>
              <th className="whitespace-nowrap py-2 pr-4">Input $/1M tok</th>
              <th className="whitespace-nowrap py-2 pr-4">Output $/1M tok</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(DEFAULT_MODEL_ROUTING).map(([stepKey, config]) => {
              const description = describeStep(stepKey);
              return (
                <tr key={stepKey} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                  <td className="py-2 pr-4">
                    <span className="font-medium">{labelAgent(stepKey)}</span>
                    {description && <span className="block text-xs text-muted-foreground">{description}</span>}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{config.provider}</td>
                  {/* A model id is one token: mono, as in the ticket trace, and never broken across lines. */}
                  <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs leading-5">{config.model}</td>
                  <td className="py-2 pr-4 tabular-nums">${config.inputCostPerMTokUsd.toFixed(2)}</td>
                  <td className="py-2 pr-4 tabular-nums">${config.outputCostPerMTokUsd.toFixed(2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}
