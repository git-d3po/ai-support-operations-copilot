# Product Specification — AI Support Operations Copilot

## The fictional company

**Halcyon** is a B2B SaaS workflow-automation and team-collaboration
platform (boards, tasks, automations, integrations) on four plans —
Starter, Growth, Scale, Enterprise — sold per-seat with add-ons (advanced
automations, analytics, SSO, priority support, extra storage, metered API
usage). All customers, accounts, invoices, transactions, tickets, and
conversations in this repository are synthetic and deterministically
generated (see ARCHITECTURE.md, "Synthetic data strategy"). Product and
policy content (`prisma/data/`) is internally consistent — the same
refund window, escalation criteria, and known issues referenced by the
Policy/Technical agents are what the curated evaluation tickets are graded
against.

## Who this is for

A **support operator** at Halcyon working the shared ticket inbox. Their
job: understand a customer's situation quickly, decide the right
resolution, and reply — correctly, consistently with policy, and fast.
The copilot's job is to do the first-pass investigation across billing,
policy, technical, and risk domains, propose a resolution and a reply, and
show its work well enough that the operator can verify or override it in
seconds rather than minutes.

## Core user flow

1. Operator opens the **Inbox**, sees tickets with status/priority/AI
   indicators, picks one.
2. **Ticket Detail** shows the customer, account, subscription, billing
   history, and conversation alongside the ticket.
3. Operator clicks **Run AI analysis**. The orchestrator classifies the
   ticket, dynamically selects which specialist agents are relevant, runs
   them, and produces a resolution/escalation decision and a proposed
   customer response.
4. Operator reviews: which agents ran and why, each agent's structured
   finding (evidence, confidence, policy citations), the resolution
   rationale, and the drafted reply — then sends, edits, or escalates.
5. Aggregated behavior across tickets shows up in **AI Operations**
   (live/demo activity) and **Evaluations** (curated-scenario scoring),
   kept visibly separate (see DECISIONS.md).

## Specialist agents

| Agent | Responsibility |
|---|---|
| **Billing Agent** | Invoices, transactions, subscription history — duplicate charges, failed payments, refund eligibility facts. |
| **Policy Agent** | Matches the ticket to the governing policy document and evaluates whether its conditions are met. |
| **Technical Agent** | Diagnoses technical issues against product documentation and known-issue records. |
| **Risk / Escalation Agent** | Security, fraud, and churn-risk signals; the safety net that can force escalation regardless of other findings. |
| **Response Agent** | Drafts the customer-facing reply from the other agents' findings and the resolution decision. |

The orchestrator selects a subset per ticket — see
`src/lib/orchestrator/selectAgents.ts` and EVALUATION.md ("routing
accuracy"). Invoking every agent for every ticket is treated as a defect,
not a safe default.

## Product surfaces

- **Inbox** — ticket list with status, priority, channel, and an AI
  indicator (has analysis been run, and on which scenario if curated).
- **Ticket Detail** — customer/account/billing context, conversation, AI
  orchestration timeline (agents invoked and why), per-agent findings,
  resolution/escalation decision, proposed response, and per-run
  model/latency/cost data.
- **AI Operations** — live/demo operational metrics: ticket volume,
  automation/containment rate, escalation rate, per-agent usage, latency,
  estimated cost, failure/retry rate. Every number is a real query result.
- **Evaluations** — the 10 curated scenarios, their expected outcomes, and
  scored results across classification/routing/policy/escalation/
  resolution/evidence-quality dimensions (EVALUATION.md).
- **Knowledge** — the actual policy documents and product documentation
  agents ground their findings in, browsable by the operator.
- **Settings** — model routing configuration and other system settings.

## Non-goals (for this project)

- Real customer data, real payment processing, or real email/chat delivery.
- Multi-tenant auth, roles, or permission systems — this is a single
  internal-tool persona (the support operator), not a customer-facing app.
- A general-purpose agent framework — the orchestrator is purpose-built for
  this pipeline (see DECISIONS.md).
- Mobile support — this is a dense, desktop-first operational tool.

## What "done" looks like for the foundation phase

The application boots, is backed by a real (if small) database of synthetic
records, every documented product surface is reachable and shows real
queried data (even where the underlying AI logic is still a labeled stub),
and the test suites (unit + e2e) pass. See TODO.md for what's explicitly
deferred to the next phase.
