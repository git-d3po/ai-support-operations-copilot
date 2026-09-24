import { db } from "@/lib/db";
import { Card } from "@/components/ui/Card";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Stat } from "@/components/ui/Stat";
import { labelAgent, labelPriority, labelTicketStatus } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const [statusCounts, priorityCounts, allRuns, simulatedRunCount] = await Promise.all([
    db.ticket.groupBy({ by: ["status"], _count: true }),
    db.ticket.groupBy({ by: ["priority"], _count: true }),
    db.orchestrationRun.findMany({ include: { agentInvocations: true } }),
    db.orchestrationRun.count({ where: { isSimulated: true } }),
  ]);

  // Simulated runs (Demo Mode scripted replays, and dry-run/test fixtures) are
  // excluded from operational metrics entirely — they'd otherwise silently
  // inflate "real" activity numbers with scripted data. See DECISIONS.md ("Honestly recording
  // which provider actually served a call").
  const runs = allRuns.filter((r) => !r.isSimulated);

  const completedRuns = runs.filter((r) => r.status === "completed");
  const failedRuns = runs.filter((r) => r.status === "failed");
  const escalatedRuns = completedRuns.filter((r) => r.escalation !== null);
  const escalationRate = completedRuns.length > 0 ? escalatedRuns.length / completedRuns.length : null;
  const containmentRate = completedRuns.length > 0 ? 1 - (escalationRate ?? 0) : null;

  const allInvocations = runs.flatMap((r) => r.agentInvocations);
  const totalEstimatedCostUsd = allInvocations.reduce((sum, inv) => sum + (inv.estimatedCostUsd ?? 0), 0);
  const failedInvocationCount = allInvocations.filter((inv) => inv.status === "failed").length;
  const invocationFailureRate = allInvocations.length > 0 ? failedInvocationCount / allInvocations.length : null;

  const agentKeys = [...new Set(allInvocations.map((inv) => inv.agentKey))];
  const perAgentStats = agentKeys.map((key) => {
    const invocations = allInvocations.filter((inv) => inv.agentKey === key);
    const latencies = invocations.map((inv) => inv.latencyMs).filter((v): v is number => v != null);
    const costs = invocations.reduce((sum, inv) => sum + (inv.estimatedCostUsd ?? 0), 0);
    const failures = invocations.filter((inv) => inv.status === "failed").length;
    return {
      key,
      count: invocations.length,
      avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
      totalCostUsd: costs,
      failures,
    };
  });

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">AI Operations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every number below is computed from live orchestration data — nothing here is a mockup. This
        is <strong>live/demo activity</strong>, not evaluation performance; see the Evaluations page for
        scored accuracy against known-correct scenarios (see DECISIONS.md, &ldquo;Why live/demo metrics
        are separated from evaluation metrics&rdquo;).
      </p>
      {simulatedRunCount > 0 && (
        <p className="mt-1 text-xs font-medium text-blue-700 dark:text-blue-400">
          {simulatedRunCount} additional simulated run(s) exist (Demo Mode scripted replays or
          fixture runs) and are intentionally excluded from every metric below — see the
          Evaluations page.
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat label="Orchestration runs" value={runs.length} />
        <Stat label="Failed runs" value={failedRuns.length} />
        <Stat label="Escalation rate" value={escalationRate != null ? `${(escalationRate * 100).toFixed(0)}%` : "—"} />
        <Stat label="Containment rate" value={containmentRate != null ? `${(containmentRate * 100).toFixed(0)}%` : "—"} />
        <Stat label="Agent invocations" value={allInvocations.length} />
        <Stat
          label="Invocation failure rate"
          value={invocationFailureRate != null ? `${(invocationFailureRate * 100).toFixed(0)}%` : "—"}
        />
        <Stat label="Estimated AI cost (all time)" value={`$${totalEstimatedCostUsd.toFixed(4)}`} />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-6">
        <Card padding="lg">
          <SectionHeading>Ticket volume by status</SectionHeading>
          <ul className="mt-2 text-sm">
            {statusCounts.map((row) => (
              <li key={row.status} className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-900">
                <span>{labelTicketStatus(row.status)}</span>
                <span>{row._count}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card padding="lg">
          <SectionHeading>Ticket volume by priority</SectionHeading>
          <ul className="mt-2 text-sm">
            {priorityCounts.map((row) => (
              <li key={row.priority} className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-900">
                <span>{labelPriority(row.priority)}</span>
                <span>{row._count}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card padding="lg" className="mt-6">
        <SectionHeading>Usage by pipeline step</SectionHeading>
        {perAgentStats.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No agent invocations recorded yet — run AI analysis on a ticket.</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-4">Step</th>
                <th className="py-1 pr-4">Invocations</th>
                <th className="py-1 pr-4">Avg latency</th>
                <th className="py-1 pr-4">Total cost</th>
                <th className="py-1 pr-4">Failures</th>
              </tr>
            </thead>
            <tbody>
              {perAgentStats.map((stat) => (
                <tr key={stat.key} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-1 pr-4">{labelAgent(stat.key)}</td>
                  <td className="py-1 pr-4">{stat.count}</td>
                  <td className="py-1 pr-4">{stat.avgLatencyMs != null ? `${Math.round(stat.avgLatencyMs)}ms` : "—"}</td>
                  <td className="py-1 pr-4">${stat.totalCostUsd.toFixed(5)}</td>
                  <td className="py-1 pr-4">{stat.failures}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card dashed padding="lg" className="mt-6 text-sm text-muted-foreground">
        Estimated cost is derived from each model&apos;s configured per-token pricing
        (src/lib/orchestrator/modelRouting.ts) applied to actual token usage — it is an estimate for
        operational visibility, not a real billing statement.
      </Card>
    </div>
  );
}
