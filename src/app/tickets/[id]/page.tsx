import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { getAiMode } from "@/lib/ai/mode";
import { DEMO_PROVIDER_KEY, isSimulatedProvider } from "@/lib/ai/providers/provenance";
import { DEMO_CURATED_ONLY_MESSAGE, hasDemoRecording } from "@/lib/demo/recordings";
import { formatCents, formatDateTime } from "@/lib/format";
import {
  labelAccountPlan,
  labelAccountStatus,
  labelAction,
  labelAgent,
  labelAgentFlag,
  labelAgentShort,
  labelChannel,
  labelIntent,
  labelInvocationStatus,
  labelInvoiceStatus,
  labelMessageAuthor,
  labelPolicyDecision,
  labelResponseTone,
  labelSentiment,
  labelSeverity,
  labelTeam,
  labelTransactionStatus,
  labelTransactionType,
} from "@/lib/labels";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Eyebrow, SectionHeading } from "@/components/ui/SectionHeading";
import type { Tone } from "@/components/ui/tone";
import { PriorityLabel, StatusLabel } from "@/components/ticket-labels";
import { RunAnalysisButton } from "./RunAnalysisButton";
import {
  isPolicyFinding,
  isRiskFinding,
  type AnyAgentFinding,
  type CustomerResponse,
  type EscalationDecision,
  type PolicyReference,
  type ResolutionDecision,
  type TicketClassification,
} from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

/**
 * Ticket detail: the operator's working view of one ticket.
 *
 * The AI section is decision-first. An operator reads, in order: the
 * recommendation (the answer), the draft reply (their deliverable), then how
 * the decision was reached (the classify -> route -> resolve -> draft
 * pipeline, with the full agent trace collapsed beneath it). Everything shown
 * is persisted run data; nothing here is computed or invented for display.
 * Canonical values are shown through src/lib/labels.ts, never raw.
 */
export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [ticket, policies] = await Promise.all([
    db.ticket.findUnique({
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
    }),
    // Policy citations link to their Knowledge entry only when that entry actually exists.
    db.policy.findMany({ select: { slug: true } }),
  ]);

  if (!ticket) notFound();

  const knownPolicySlugs = new Set(policies.map((p) => p.slug));
  const account = ticket.customer.account;
  const latestRun = ticket.orchestrationRuns[0] ?? null;

  // Demo Mode is resolved on the server. A ticket without a scripted recording
  // (anything outside the curated scenarios) cannot be analyzed in Demo Mode,
  // and the action refuses it too; this only makes that visible up front.
  const demoMode = getAiMode() === "demo";
  const demoDisabledReason = demoMode && !hasDemoRecording(ticket.scenarioKey) ? DEMO_CURATED_ONLY_MESSAGE : null;
  const isDemoRun = latestRun?.agentInvocations.some((inv) => inv.provider === DEMO_PROVIDER_KEY) ?? false;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_320px] gap-6 p-6">
      <div>
        <header>
          <h1 className="text-lg font-semibold">{ticket.subject}</h1>
          <dl className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <MetaItem label="Status">
              <StatusLabel status={ticket.status} />
            </MetaItem>
            <MetaItem label="Priority">
              <PriorityLabel priority={ticket.priority} />
            </MetaItem>
            <MetaItem label="Channel">{labelChannel(ticket.channel)}</MetaItem>
            {ticket.evaluationCase && (
              <MetaItem label="Eval scenario">
                {/* Evaluation metadata: the canonical scenario key is intentionally shown as-is. */}
                <Badge tone="neutral">{ticket.evaluationCase.scenarioKey}</Badge>
              </MetaItem>
            )}
          </dl>
        </header>

        <section className="mt-6" aria-labelledby="conversation-heading">
          <SectionHeading id="conversation-heading">Conversation</SectionHeading>
          <div className="mt-2 flex flex-col gap-3">
            {ticket.messages.map((message) => (
              <Card key={message.id} padding="md" className="text-sm">
                <div className="mb-1 flex justify-between gap-4 text-xs text-muted-foreground">
                  <span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">{message.authorName}</span>
                    {" · "}
                    {labelMessageAuthor(message.author)}
                  </span>
                  <span>{formatDateTime(message.sentAt)}</span>
                </div>
                <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{message.body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="mt-8" aria-labelledby="ai-heading">
          <div className="flex items-start justify-between gap-4">
            <SectionHeading id="ai-heading">AI orchestration</SectionHeading>
            <RunAnalysisButton
              ticketId={ticket.id}
              hasRunBefore={ticket.orchestrationRuns.length > 0}
              demoMode={demoMode}
              disabledReason={demoDisabledReason}
            />
          </div>

          {!latestRun && (
            <Card dashed padding="lg" className="mt-2 text-sm text-muted-foreground">
              No AI analysis has been run on this ticket yet.
            </Card>
          )}

          {latestRun && latestRun.status === "failed" && (
            <Card tone="danger" padding="lg" className="mt-2 text-sm">
              <p className="font-medium">Analysis failed</p>
              <p className="mt-1">{latestRun.errorMessage}</p>
            </Card>
          )}

          {latestRun && latestRun.status === "completed" && (
            <div className="mt-3 flex flex-col gap-5">
              {latestRun.isSimulated && (
                <Card tone="info" padding="sm" className="text-xs font-medium">
                  {isDemoRun
                    ? "SIMULATED RUN — demo replay of scripted responses; no model was called. Not a measure of real AI performance."
                    : "SIMULATED RUN — one or more steps were served by a deterministic fixture provider, not a real model. Not a measure of real AI performance."}
                </Card>
              )}

              <RecommendationPanel
                resolution={latestRun.resolution as unknown as ResolutionDecision | null}
                escalation={latestRun.escalation as unknown as EscalationDecision | null}
              />

              <DraftReply
                response={latestRun.response as unknown as CustomerResponse | null}
                simulated={latestRun.isSimulated}
              />

              <DecisionTrace
                classification={latestRun.classification as unknown as TicketClassification | null}
                resolution={latestRun.resolution as unknown as ResolutionDecision | null}
                hasResponse={latestRun.response != null}
                invocations={latestRun.agentInvocations}
                knownPolicySlugs={knownPolicySlugs}
              />
            </div>
          )}
        </section>
      </div>

      <aside className="flex flex-col gap-4">
        <Card padding="md" surface className="text-sm">
          <Eyebrow>Customer</Eyebrow>
          <p className="mt-1 font-medium">{ticket.customer.name}</p>
          <p className="text-muted-foreground">{ticket.customer.company}</p>
          <p className="text-muted-foreground">{ticket.customer.email}</p>
        </Card>

        {account && (
          <Card padding="md" surface className="text-sm">
            <Eyebrow>Account</Eyebrow>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="font-medium">{labelAccountPlan(account.plan)}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>{labelAccountStatus(account.status)}</dd>
              <dt className="text-muted-foreground">MRR</dt>
              <dd className="tabular-nums">{formatCents(account.mrrCents)}</dd>
              <dt className="text-muted-foreground">Risk score</dt>
              <dd className="tabular-nums">{account.riskScore}</dd>
            </dl>

            <Eyebrow as="h4" className="mt-4">
              Recent invoices
            </Eyebrow>
            <ul className="mt-1 flex flex-col gap-1">
              {account.invoices.map((invoice) => (
                <li key={invoice.id} className="flex justify-between gap-4">
                  <span>{labelInvoiceStatus(invoice.status)}</span>
                  <span className="tabular-nums">{formatCents(invoice.amountCents)}</span>
                </li>
              ))}
            </ul>

            <Eyebrow as="h4" className="mt-4">
              Recent transactions
            </Eyebrow>
            <ul className="mt-1 flex flex-col gap-1">
              {account.transactions.map((tx) => (
                <li key={tx.id} className="flex justify-between gap-4">
                  <span>
                    {labelTransactionType(tx.type)}
                    <span className="text-muted-foreground"> · {labelTransactionStatus(tx.status)}</span>
                  </span>
                  <span className="tabular-nums">{formatCents(tx.amountCents)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </aside>
    </div>
  );
}

function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Categorical severity to the shared tones. Not a threshold on any score: severity is already a category in the data. */
const SEVERITY_TONE: Record<EscalationDecision["severity"], Tone> = {
  critical: "danger",
  high: "warning",
  medium: "neutral",
  low: "neutral",
};

const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The operator's answer, from the persisted resolution and escalation. The
 * one raised surface on the page (the `surface` fill plus the reserved
 * `shadow-sm`). When the escalation reason is the same text as the resolution
 * summary (resolve.ts often uses one value for both), it is shown once.
 */
function RecommendationPanel({
  resolution,
  escalation,
}: {
  resolution: ResolutionDecision | null;
  escalation: EscalationDecision | null;
}) {
  if (!resolution) return null;

  const escalationNote =
    escalation && normalizeText(escalation.reason) !== normalizeText(resolution.summary) ? escalation.reason : null;
  const headline =
    resolution.action === "escalate" && escalation
      ? `${labelAction(resolution.action)} to ${labelTeam(escalation.targetTeam)}`
      : labelAction(resolution.action);

  return (
    <section aria-labelledby="recommendation-heading" className="rounded border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow id="recommendation-heading">Recommendation</Eyebrow>
        {resolution.requiresHumanReview ? (
          <Badge tone="warning">Human review required</Badge>
        ) : (
          <Badge tone="neutral">No human review required</Badge>
        )}
      </div>

      <p className="mt-2 text-xl font-semibold tracking-tight">{headline}</p>

      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {escalation && (
          <>
            <Fact label="Team">{labelTeam(escalation.targetTeam)}</Fact>
            <Fact label="Severity">
              <Badge tone={SEVERITY_TONE[escalation.severity]}>{labelSeverity(escalation.severity)}</Badge>
            </Fact>
          </>
        )}
        <Fact label="Confidence">
          <span className="tabular-nums">{resolution.confidence.toFixed(2)}</span>
        </Fact>
      </dl>

      <p className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{resolution.summary}</p>

      {escalationNote && (
        <div className="mt-3 border-t border-border pt-3">
          <Eyebrow as="h4">Escalation note</Eyebrow>
          <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{escalationNote}</p>
        </div>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

/** The operator's deliverable. Always a draft: nothing in this app sends a message. */
function DraftReply({ response, simulated }: { response: CustomerResponse | null; simulated: boolean }) {
  if (!response) return null;
  return (
    <section aria-labelledby="draft-reply-heading">
      <Card padding="md" className="text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow id="draft-reply-heading">Draft reply</Eyebrow>
          <Badge tone="neutral">Not sent</Badge>
        </div>
        {simulated && (
          <p className="mt-1 text-xs font-medium text-blue-800 dark:text-blue-300">
            Scripted draft only — no refund, email, payment, account change, or other external action was actually executed.
          </p>
        )}

        <div className="mt-3 border-l-2 border-border pl-3">
          {response.subject && <p className="font-medium">{response.subject}</p>}
          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-zinc-800 dark:text-zinc-200">{response.body}</p>
        </div>

        {response.nextSteps.length > 0 && (
          <div className="mt-3">
            <Eyebrow as="h4">Next steps in the reply</Eyebrow>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-zinc-700 dark:text-zinc-300">
              {response.nextSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-3 text-xs text-muted-foreground">Tone: {labelResponseTone(response.tone)}</p>
      </Card>
    </section>
  );
}

type Invocation = {
  id: string;
  agentKey: string;
  status: string;
  model: string;
  provider: string;
  latencyMs: number | null;
  estimatedCostUsd: number | null;
  finding: unknown;
};

/**
 * How the recommendation was reached: the pipeline as a compact strip (always
 * visible, so the orchestration is legible at a glance), then the full
 * per-step agent trace collapsed beneath it. Every value is persisted run
 * data; the "Routed" step lists exactly the specialists that ran.
 */
function DecisionTrace({
  classification,
  resolution,
  hasResponse,
  invocations,
  knownPolicySlugs,
}: {
  classification: TicketClassification | null;
  resolution: ResolutionDecision | null;
  hasResponse: boolean;
  invocations: Invocation[];
  knownPolicySlugs: Set<string>;
}) {
  const specialists = invocations.filter((inv) => inv.agentKey !== "classifier" && inv.agentKey !== "response");
  const steps: { label: string; value: string }[] = [
    { label: "Classified", value: classification ? labelIntent(classification.intent) : "—" },
    {
      label: "Routed",
      value:
        specialists.length > 0
          ? specialists.map((s) => `${labelAgentShort(s.agentKey)}${s.status === "failed" ? " (failed)" : ""}`).join(", ")
          : "No specialist needed",
    },
    { label: "Resolved", value: resolution ? labelAction(resolution.action) : "—" },
    { label: "Drafted", value: hasResponse ? "Customer reply" : "No reply" },
  ];

  return (
    <section aria-labelledby="trace-heading">
      <Eyebrow id="trace-heading">How this was decided</Eyebrow>
      <p className="mt-1 text-xs text-muted-foreground">
        The ticket&apos;s intent decides which specialists run; the resolution rules then combine their findings into
        the recommendation above.
      </p>

      <ol aria-label="Decision pipeline" className="mt-3 flex flex-wrap items-center gap-y-2 text-sm">
        {steps.map((step, i) => (
          <li key={step.label} className="flex items-center">
            {i > 0 && (
              <span aria-hidden className="px-2 text-muted-foreground">
                →
              </span>
            )}
            <div className="rounded border border-border px-2.5 py-1.5">
              <div className="text-xs text-muted-foreground">{step.label}</div>
              <div className="font-medium">{step.value}</div>
            </div>
          </li>
        ))}
      </ol>

      <details className="mt-4">
        <summary className="cursor-pointer select-none text-sm font-medium text-zinc-700 hover:text-foreground dark:text-zinc-300">
          Agent trace ({invocations.length} steps)
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {invocations.map((inv) => (
            <AgentTraceCard key={inv.id} invocation={inv} knownPolicySlugs={knownPolicySlugs} />
          ))}
        </div>
      </details>
    </section>
  );
}

function AgentTraceCard({ invocation, knownPolicySlugs }: { invocation: Invocation; knownPolicySlugs: Set<string> }) {
  const { agentKey, status, model, provider, latencyMs, estimatedCostUsd, finding } = invocation;
  const isClassifier = agentKey === "classifier";
  const classification = isClassifier ? (finding as TicketClassification | null) : null;
  const agentFinding = !isClassifier ? (finding as AnyAgentFinding | null) : null;
  const isSimulated = isSimulatedProvider(provider);

  // Machine detail, deliberately quiet. A simulated step never called a model, so
  // it has no real latency or cost to report; say so rather than show "0ms · $0".
  const machineDetail = isSimulated
    ? `${model} · not called (${provider === DEMO_PROVIDER_KEY ? "scripted replay" : "fixture"})`
    : `${model} · ${latencyMs != null ? `${latencyMs}ms` : "—"} · ${estimatedCostUsd != null ? `~$${estimatedCostUsd.toFixed(5)}` : "—"}`;

  // A Policy decision's own policy is cited once, alongside any other references.
  const citations: PolicyReference[] = agentFinding ? [...agentFinding.policyReferences] : [];
  if (agentFinding && isPolicyFinding(agentFinding) && agentFinding.policyDecision) {
    const applicable = agentFinding.policyDecision.applicablePolicy;
    if (!citations.some((c) => c.slug === applicable.slug)) citations.push(applicable);
  }

  return (
    <Card padding="md" className="text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{labelAgent(agentKey)}</span>
        <div className="flex gap-1">
          {isSimulated && <Badge tone="info">simulated ({provider})</Badge>}
          <Badge tone={status === "succeeded" ? "success" : "danger"}>{labelInvocationStatus(status)}</Badge>
        </div>
      </div>

      {classification && (
        <>
          <p className="mt-1.5">{classification.summary}</p>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
            <Fact label="Intent">{labelIntent(classification.intent)}</Fact>
            <Fact label="Domains">
              {classification.domains.length > 0 ? classification.domains.map(labelAgentShort).join(", ") : "None"}
            </Fact>
            <Fact label="Sentiment">{labelSentiment(classification.sentiment)}</Fact>
            <Fact label="Confidence">
              <span className="tabular-nums">{classification.confidence.toFixed(2)}</span>
            </Fact>
          </dl>
        </>
      )}

      {agentFinding && (
        <>
          <p className="mt-1.5">{agentFinding.summary}</p>

          {agentFinding.evidence.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-zinc-700 dark:text-zinc-300">
              {agentFinding.evidence.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

          {isPolicyFinding(agentFinding) && agentFinding.policyDecision && (
            <div className="mt-2">
              <p className="font-medium">Decision: {labelPolicyDecision(agentFinding.policyDecision.decision)}</p>
              <p className="mt-0.5 text-zinc-700 dark:text-zinc-300">{agentFinding.policyDecision.justification}</p>
            </div>
          )}

          {isRiskFinding(agentFinding) && agentFinding.escalationRecommended && (
            <p className="mt-2 font-medium text-amber-700 dark:text-amber-400">
              Recommends escalation
              {agentFinding.targetTeam && <> to {labelTeam(agentFinding.targetTeam)}</>}
              {agentFinding.severity && <> · {labelSeverity(agentFinding.severity)} severity</>}
            </p>
          )}

          {citations.length > 0 && (
            <p className="mt-2">
              <span className="text-muted-foreground">Cites </span>
              {citations.map((ref, i) => (
                <span key={ref.slug}>
                  {i > 0 && ", "}
                  <PolicyCitation reference={ref} known={knownPolicySlugs.has(ref.slug)} />
                </span>
              ))}
            </p>
          )}

          <p className="mt-2 text-xs text-muted-foreground">
            Confidence <span className="tabular-nums">{agentFinding.confidence.toFixed(2)}</span>
            {agentFinding.flags.length > 0 && <> · Flags: {agentFinding.flags.map(labelAgentFlag).join(", ")}</>}
          </p>
        </>
      )}

      <p className="mt-2 border-t border-border pt-2 font-mono text-xs text-muted-foreground">{machineDetail}</p>
    </Card>
  );
}

/** A policy citation. Links to the policy's Knowledge entry (`/knowledge#policy-<slug>`) only when that entry exists. */
function PolicyCitation({ reference, known }: { reference: PolicyReference; known: boolean }) {
  if (!known) return <span className="font-medium">{reference.title}</span>;
  return (
    <Link
      href={`/knowledge#policy-${reference.slug}`}
      className="font-medium underline decoration-border underline-offset-2 hover:decoration-current"
    >
      {reference.title}
    </Link>
  );
}
