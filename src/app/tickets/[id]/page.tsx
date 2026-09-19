import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatCents, formatDateTime } from "@/lib/format";
import { RunAnalysisButton } from "./RunAnalysisButton";
import {
  isPolicyFinding,
  isRiskFinding,
  type AnyAgentFinding,
  type CustomerResponse,
  type EscalationDecision,
  type ResolutionDecision,
  type TicketClassification,
} from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

const AGENT_LABEL: Record<string, string> = {
  classifier: "Classification",
  billing: "Billing Agent",
  policy: "Policy Agent",
  technical: "Technical Support Agent",
  risk: "Risk / Escalation Agent",
  response: "Response Agent",
};

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
      orchestrationRuns: { orderBy: { startedAt: "desc" }, include: { agentInvocations: { orderBy: { startedAt: "asc" } } } },
    },
  });

  if (!ticket) notFound();

  const account = ticket.customer.account;
  const latestRun = ticket.orchestrationRuns[0] ?? null;

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
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">AI orchestration</h2>
            <RunAnalysisButton ticketId={ticket.id} hasRunBefore={ticket.orchestrationRuns.length > 0} />
          </div>

          {!latestRun && (
            <p className="mt-2 rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
              No AI analysis has been run on this ticket yet.
            </p>
          )}

          {latestRun && latestRun.status === "failed" && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              <p className="font-medium">Analysis failed</p>
              <p className="mt-1">{latestRun.errorMessage}</p>
            </div>
          )}

          {latestRun && latestRun.status === "completed" && (
            <div className="mt-3 flex flex-col gap-4">
              {latestRun.isSimulated && (
                <div className="rounded border border-purple-200 bg-purple-50 p-2 text-xs font-medium text-purple-800 dark:border-purple-900 dark:bg-purple-950 dark:text-purple-300">
                  SIMULATED RUN — one or more steps were served by a deterministic fixture
                  provider, not a real model. Not a measure of real AI performance.
                </div>
              )}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Agents invoked ({latestRun.agentInvocations.length})
                </h3>
                <div className="mt-2 flex flex-col gap-2">
                  {latestRun.agentInvocations.map((inv) => (
                    <AgentInvocationCard
                      key={inv.id}
                      agentKey={inv.agentKey}
                      status={inv.status}
                      model={inv.model}
                      provider={inv.provider}
                      latencyMs={inv.latencyMs}
                      estimatedCostUsd={inv.estimatedCostUsd}
                      finding={inv.finding as unknown}
                    />
                  ))}
                </div>
              </div>

              <ResolutionCard
                resolution={latestRun.resolution as unknown as ResolutionDecision | null}
                escalation={latestRun.escalation as unknown as EscalationDecision | null}
              />

              <ProposedResponseCard response={latestRun.response as unknown as CustomerResponse | null} />
            </div>
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

function AgentInvocationCard({
  agentKey,
  status,
  model,
  provider,
  latencyMs,
  estimatedCostUsd,
  finding,
}: {
  agentKey: string;
  status: string;
  model: string;
  provider: string;
  latencyMs: number | null;
  estimatedCostUsd: number | null;
  finding: unknown;
}) {
  const label = AGENT_LABEL[agentKey] ?? agentKey;
  const isClassifier = agentKey === "classifier";
  const classification = isClassifier ? (finding as TicketClassification | null) : null;
  const agentFinding = !isClassifier ? (finding as AnyAgentFinding | null) : null;
  const isSimulated = provider !== "anthropic";

  return (
    <div className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <div className="flex gap-1">
          {isSimulated && (
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-950 dark:text-purple-300">
              simulated ({provider})
            </span>
          )}
          <span
            className={
              status === "succeeded"
                ? "rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : "rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300"
            }
          >
            {status}
          </span>
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {model} · {latencyMs != null ? `${latencyMs}ms` : "—"} ·{" "}
        {estimatedCostUsd != null ? `~$${estimatedCostUsd.toFixed(5)}` : "—"}
      </p>

      {classification && (
        <div className="mt-2">
          <p>{classification.summary}</p>
          <p className="mt-1 text-xs text-zinc-500">
            intent: {classification.intent} · domains: {classification.domains.join(", ") || "none"} · sentiment:{" "}
            {classification.sentiment} · confidence: {classification.confidence.toFixed(2)}
          </p>
        </div>
      )}

      {agentFinding && (
        <div className="mt-2">
          <p>{agentFinding.summary}</p>
          {agentFinding.evidence.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-xs text-zinc-500">
              {agentFinding.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-zinc-500">
            confidence: {agentFinding.confidence.toFixed(2)}
            {agentFinding.flags.length > 0 && <> · flags: {agentFinding.flags.join(", ")}</>}
          </p>
          {agentFinding.policyReferences.length > 0 && (
            <p className="mt-1 text-xs text-zinc-500">
              policy: {agentFinding.policyReferences.map((p) => p.title).join(", ")}
            </p>
          )}
          {isPolicyFinding(agentFinding) && agentFinding.policyDecision && (
            <p className="mt-1 text-xs font-medium">decision: {agentFinding.policyDecision.decision}</p>
          )}
          {isRiskFinding(agentFinding) && agentFinding.escalationRecommended && (
            <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
              recommends escalation to {agentFinding.targetTeam} ({agentFinding.severity})
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ResolutionCard({
  resolution,
  escalation,
}: {
  resolution: ResolutionDecision | null;
  escalation: EscalationDecision | null;
}) {
  if (!resolution) return null;
  return (
    <div className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Resolution</h3>
      <p className="mt-1 font-medium">{resolution.action}</p>
      <p className="mt-1 text-zinc-700 dark:text-zinc-300">{resolution.summary}</p>
      <p className="mt-1 text-xs text-zinc-500">
        confidence: {resolution.confidence.toFixed(2)} · requires human review:{" "}
        {resolution.requiresHumanReview ? "yes" : "no"}
      </p>
      {escalation && (
        <div className="mt-2 rounded bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <p className="text-xs font-semibold uppercase tracking-wide">Escalation</p>
          <p className="mt-1">{escalation.reason}</p>
          <p className="mt-1 text-xs">
            team: {escalation.targetTeam} · severity: {escalation.severity}
          </p>
        </div>
      )}
    </div>
  );
}

function ProposedResponseCard({ response }: { response: CustomerResponse | null }) {
  if (!response) return null;
  return (
    <div className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Proposed response</h3>
      {response.subject && <p className="mt-1 font-medium">{response.subject}</p>}
      <p className="mt-1 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{response.body}</p>
      <p className="mt-1 text-xs text-zinc-500">tone: {response.tone}</p>
      {response.nextSteps.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-xs text-zinc-500">
          {response.nextSteps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
