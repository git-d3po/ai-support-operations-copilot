import { DEFAULT_MODEL_ROUTING } from "@/lib/orchestrator/modelRouting";
import { AGENT_REGISTRY } from "@/lib/orchestrator/agents/registry";
import type { AgentKey } from "@/lib/ai/schemas";

const STEP_LABEL: Record<string, string> = {
  classifier: "Ticket classification (runs before agent selection)",
};

function labelFor(stepKey: string): string {
  return STEP_LABEL[stepKey] ?? AGENT_REGISTRY[stepKey as AgentKey]?.description ?? stepKey;
}

export default function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Model routing is per pipeline step and configurable — provider and
        model are independent, so a step can move to a different provider
        without any other code changing. This table reflects the actual
        config in src/lib/orchestrator/modelRouting.ts, not a mockup.
      </p>

      <table className="mt-4 w-full max-w-3xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <th className="py-2 pr-4">Pipeline step</th>
            <th className="py-2 pr-4">Provider</th>
            <th className="py-2 pr-4">Model</th>
            <th className="py-2 pr-4">Input $/1M tok</th>
            <th className="py-2 pr-4">Output $/1M tok</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(DEFAULT_MODEL_ROUTING).map(([stepKey, config]) => (
            <tr key={stepKey} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-2 pr-4 font-medium">{labelFor(stepKey)}</td>
              <td className="py-2 pr-4 text-zinc-500">{config.provider}</td>
              <td className="py-2 pr-4">{config.model}</td>
              <td className="py-2 pr-4">${config.inputCostPerMTokUsd.toFixed(2)}</td>
              <td className="py-2 pr-4">${config.outputCostPerMTokUsd.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        Editing model routing from this page is Phase 2 — for now, change
        src/lib/orchestrator/modelRouting.ts directly.
      </div>
    </div>
  );
}
