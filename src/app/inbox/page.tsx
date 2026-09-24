import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { formatDate, formatTime } from "@/lib/format";
import { labelChannel } from "@/lib/labels";
import { Badge } from "@/components/ui/Badge";
import { PriorityLabel, RecommendationLabel, StatusLabel } from "@/components/ticket-labels";
import type { ResolutionDecision } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Inbox" };

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
        {tickets.length} tickets. The AI recommendation comes from each ticket&apos;s latest
        analysis. It is a proposal: nothing is carried out automatically.
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
              {/* Visually short, so the header is not the column's widest word; the full name is still announced. */}
              <th className="py-2 pr-4">
                AI<span className="sr-only"> recommendation</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              // The whole row opens the ticket, through its one link: the subject link's
              // ::after stretches over the row (the row is its containing block), so a
              // click anywhere lands on the link, keyboard users meet one stop per row,
              // and there are no nested interactive elements. Its focus ring is drawn
              // around the row, since the row is what it opens.
              <tr
                key={ticket.id}
                className="group relative border-b border-zinc-100 transition-colors hover:bg-surface dark:border-zinc-900"
              >
                <td className="py-2 pr-4">
                  <Link
                    href={`/tickets/${ticket.id}`}
                    className="font-medium group-hover:underline after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-foreground"
                  >
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
                {/* Date and time each stay whole: the cell wraps between them, never inside one. */}
                <td className="py-2 pr-4 text-muted-foreground">
                  <span className="whitespace-nowrap">{formatDate(ticket.createdAt)}</span>{" "}
                  <span className="whitespace-nowrap">{formatTime(ticket.createdAt)}</span>
                </td>
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
  // The recommendation, not an outcome (see ticket-labels.tsx). A recorded escalation always comes with
  // the `escalate` action (resolve.ts); the fallback only covers a run persisted without a resolution.
  const action =
    (latestRun?.resolution as ResolutionDecision | null)?.action ?? (latestRun?.escalation != null ? "escalate" : null);
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      {/* The scenario key is evaluation metadata, deliberately shown as its canonical identifier. One box
          (inline-block), so in a narrow column it wraps at a hyphen inside the tag instead of splitting the
          tag's background across lines. Not no-wrap: an unbreakable key widened this column enough to make
          the 1024px Inbox 18% taller (measured), which cost more readability than the break. */}
      {evaluationScenarioKey && (
        <Badge tone="neutral" className="inline-block">
          eval: {evaluationScenarioKey}
        </Badge>
      )}
      {!latestRun && <span className="text-muted-foreground">Not analyzed</span>}
      {latestRun?.status === "failed" && <Badge tone="danger">Analysis failed</Badge>}
      {latestRun?.status === "completed" &&
        (action ? <RecommendationLabel action={action} /> : <span className="text-muted-foreground">No recommendation</span>)}
    </div>
  );
}
