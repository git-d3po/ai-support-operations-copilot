import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const ticket = await db.ticket.findUnique({
    where: { id },
    include: {
      customer: {
        include: {
          account: {
            include: {
              subscriptions: { include: { items: { include: { product: true } } } },
              invoices: { orderBy: { issuedAt: "desc" }, take: 5 },
              transactions: { orderBy: { occurredAt: "desc" }, take: 5 },
            },
          },
        },
      },
      messages: { orderBy: { sentAt: "asc" } },
      evaluationCase: true,
      orchestrationRuns: { orderBy: { startedAt: "desc" }, include: { agentInvocations: true } },
    },
  });

  if (!ticket) notFound();

  const account = ticket.customer.account;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-6 p-6">
      <div>
        <h1 className="text-lg font-semibold">{ticket.subject}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {ticket.status} · {ticket.priority} priority · {ticket.channel}
          {ticket.evaluationCase && (
            <span className="ml-2 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              eval scenario: {ticket.evaluationCase.scenarioKey}
            </span>
          )}
        </p>

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Conversation</h2>
          <div className="mt-2 flex flex-col gap-3">
            {ticket.messages.map((message) => (
              <div key={message.id} className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <div className="mb-1 flex justify-between text-xs text-zinc-500">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {message.authorName} ({message.author})
                  </span>
                  <span>{formatDateTime(message.sentAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{message.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">AI orchestration</h2>
          {ticket.orchestrationRuns.length === 0 ? (
            <p className="mt-2 rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
              No AI analysis has been run on this ticket yet. Running analysis
              (orchestrator → specialist agents → resolution) is Phase 2 —
              see TODO.md. The orchestrator module and agent contracts already
              exist under src/lib/orchestrator/.
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">
              {ticket.orchestrationRuns.length} run(s) recorded.
            </p>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Customer</h3>
          <p className="mt-1 font-medium">{ticket.customer.name}</p>
          <p className="text-zinc-500">{ticket.customer.company}</p>
          <p className="text-zinc-500">{ticket.customer.email}</p>
        </div>

        {account && (
          <div className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Account</h3>
            <p className="mt-1">
              Plan: <span className="font-medium">{account.plan}</span>
            </p>
            <p>Status: {account.status}</p>
            <p>MRR: {formatCents(account.mrrCents)}</p>
            <p>Risk score: {account.riskScore}</p>

            <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Recent invoices
            </h4>
            <ul className="mt-1 flex flex-col gap-1">
              {account.invoices.map((invoice) => (
                <li key={invoice.id} className="flex justify-between">
                  <span>{invoice.status}</span>
                  <span>{formatCents(invoice.amountCents)}</span>
                </li>
              ))}
            </ul>

            <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Recent transactions
            </h4>
            <ul className="mt-1 flex flex-col gap-1">
              {account.transactions.map((tx) => (
                <li key={tx.id} className="flex justify-between">
                  <span>
                    {tx.type} ({tx.status})
                  </span>
                  <span>{formatCents(tx.amountCents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
