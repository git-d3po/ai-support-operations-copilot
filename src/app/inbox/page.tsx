import Link from "next/link";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import type { ResolutionDecision } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  pending: "Pending",
  escalated: "Escalated",
  resolved: "Resolved",
  closed: "Closed",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export default async function InboxPage() {
  const tickets = await db.ticket.findMany({
    include: {
      customer: true,
      evaluationCase: true,
      orchestrationRuns: { orderBy: { startedAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Inbox</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {tickets.length} tickets. The AI column reflects each ticket&apos;s actual latest orchestration
        run, not a placeholder.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <th className="py-2 pr-4">Subject</th>
              <th className="py-2 pr-4">Customer</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Priority</th>
              <th className="py-2 pr-4">Channel</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4">AI</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr
                key={ticket.id}
                className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900"
              >
                <td className="py-2 pr-4">
                  <Link href={`/tickets/${ticket.id}`} className="font-medium hover:underline">
                    {ticket.subject}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                  {ticket.customer.name}
                  <span className="text-zinc-400"> · {ticket.customer.company}</span>
                </td>
                <td className="py-2 pr-4">{STATUS_LABEL[ticket.status] ?? ticket.status}</td>
                <td className="py-2 pr-4">{PRIORITY_LABEL[ticket.priority] ?? ticket.priority}</td>
                <td className="py-2 pr-4 text-zinc-500">{ticket.channel}</td>
                <td className="py-2 pr-4 text-zinc-500">{formatDateTime(ticket.createdAt)}</td>
                <td className="py-2 pr-4">
                  <AiIndicator
                    evaluationScenarioKey={ticket.evaluationCase?.scenarioKey ?? null}
                    latestRun={ticket.orchestrationRuns[0] ?? null}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AiIndicator({
  evaluationScenarioKey,
  latestRun,
}: {
  evaluationScenarioKey: string | null;
  latestRun: { status: string; escalation: unknown; resolution: unknown } | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {evaluationScenarioKey && (
        <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
          eval: {evaluationScenarioKey}
        </span>
      )}
      {!latestRun && <span className="text-xs text-zinc-400">not analyzed</span>}
      {latestRun?.status === "failed" && (
        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300">
          analysis failed
        </span>
      )}
      {latestRun?.status === "completed" && latestRun.escalation != null && (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          escalated
        </span>
      )}
      {latestRun?.status === "completed" && latestRun.escalation == null && (
        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {(latestRun.resolution as ResolutionDecision | null)?.action ?? "resolved"}
        </span>
      )}
    </div>
  );
}
