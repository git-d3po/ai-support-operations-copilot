import Link from "next/link";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { labelAction, labelChannel } from "@/lib/labels";
import { Badge } from "@/components/ui/Badge";
import { PriorityLabel, StatusLabel } from "@/components/ticket-labels";
import type { ResolutionDecision } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

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
      <p className="mt-1 text-sm text-muted-foreground">
        {tickets.length} tickets. The AI column reflects each ticket&apos;s actual latest orchestration
        run, not a placeholder.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
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
              <tr key={ticket.id} className="border-b border-zinc-100 hover:bg-surface dark:border-zinc-900">
                <td className="py-2 pr-4">
                  <Link href={`/tickets/${ticket.id}`} className="font-medium hover:underline">
                    {ticket.subject}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                  {ticket.customer.name}
                  <span className="text-muted-foreground"> · {ticket.customer.company}</span>
                </td>
                <td className="py-2 pr-4">
                  <StatusLabel status={ticket.status} />
                </td>
                <td className="py-2 pr-4">
                  <PriorityLabel priority={ticket.priority} />
                </td>
                <td className="py-2 pr-4 text-muted-foreground">{labelChannel(ticket.channel)}</td>
                <td className="py-2 pr-4 text-muted-foreground">{formatDateTime(ticket.createdAt)}</td>
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
  const action = (latestRun?.resolution as ResolutionDecision | null)?.action;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {/* The scenario key is evaluation metadata, deliberately shown as its canonical identifier. */}
      {evaluationScenarioKey && <Badge tone="neutral">eval: {evaluationScenarioKey}</Badge>}
      {!latestRun && <span className="text-xs text-muted-foreground">Not analyzed</span>}
      {latestRun?.status === "failed" && <Badge tone="danger">Analysis failed</Badge>}
      {latestRun?.status === "completed" && latestRun.escalation != null && <Badge tone="warning">Escalated</Badge>}
      {latestRun?.status === "completed" && latestRun.escalation == null && (
        <Badge tone="success">{action ? labelAction(action) : "Resolved"}</Badge>
      )}
    </div>
  );
}
