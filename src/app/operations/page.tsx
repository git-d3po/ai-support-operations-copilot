import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const [statusCounts, priorityCounts, orchestrationRunCount] = await Promise.all([
    db.ticket.groupBy({ by: ["status"], _count: true }),
    db.ticket.groupBy({ by: ["priority"], _count: true }),
    db.orchestrationRun.count(),
  ]);

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">AI Operations</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Every number below is computed from the live database — there are no
        placeholder metrics on this page.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-6">
        <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Ticket volume by status</h2>
          <ul className="mt-2 text-sm">
            {statusCounts.map((row) => (
              <li key={row.status} className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-900">
                <span>{row.status}</span>
                <span>{row._count}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold">Ticket volume by priority</h2>
          <ul className="mt-2 text-sm">
            {priorityCounts.map((row) => (
              <li key={row.priority} className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-900">
                <span>{row.priority}</span>
                <span>{row._count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        {orchestrationRunCount} orchestration runs recorded. AI-specific
        metrics (automation/containment rate, escalation rate, agent usage,
        latency, estimated cost) will appear here once the orchestrator is
        wired to a live API route in Phase 2 — see TODO.md. This page will
        continue to distinguish live/demo activity from evaluation results
        rather than mixing them (see DECISIONS.md).
      </div>
    </div>
  );
}
