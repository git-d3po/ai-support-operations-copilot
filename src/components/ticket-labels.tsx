import { Badge } from "@/components/ui/Badge";
import { labelAction, labelPriority, labelTicketStatus } from "@/lib/labels";

/**
 * How a ticket's state and the AI's output are shown, wherever a ticket appears
 * (inbox and ticket detail), so the two never disagree. Three different things,
 * deliberately kept apart (DECISIONS.md, "Ticket state vs AI recommendation"):
 *
 * - Ticket status (`StatusLabel`): the ticket's actual workflow state. Only a
 *   state that is true may carry an outcome tone: `escalated` is danger,
 *   `resolved`/`closed` are success.
 * - AI recommendation (`RecommendationLabel`): what the orchestration proposes.
 *   Nothing in this app executes it, so it is never shown as done: it uses the
 *   action's imperative label ("Escalate", "Refund customer", "Auto-resolve"),
 *   and never the success tone. A recommended escalation is a `warning` badge
 *   (it needs a person); every other recommendation is plain text.
 * - Step outcome (trace, evaluations): what a pipeline step or a scored run
 *   actually produced ("Succeeded", "Failed", "Pass"), so it may use outcome
 *   tones.
 *
 * Only the values an operator must notice get a color; the rest stay plain
 * text so a column doesn't turn into a wall of color. Badge text is sentence
 * case; canonical identifiers (a scenario key such as `duplicate-billing`) are
 * shown as-is. Tones come from the shared semantic map (src/components/ui/tone.ts).
 */
export function StatusLabel({ status }: { status: string }) {
  const label = labelTicketStatus(status);
  if (status === "escalated") return <Badge tone="danger">{label}</Badge>;
  if (status === "resolved" || status === "closed") return <Badge tone="success">{label}</Badge>;
  return <span>{label}</span>;
}

export function PriorityLabel({ priority }: { priority: string }) {
  const label = labelPriority(priority);
  if (priority === "urgent") return <Badge tone="danger">{label}</Badge>;
  if (priority === "high") return <Badge tone="warning">{label}</Badge>;
  return <span>{label}</span>;
}

/** The latest analysis's recommended action (a `ResolutionDecision.action`): a proposal, never an outcome. */
export function RecommendationLabel({ action }: { action: string }) {
  const label = labelAction(action);
  if (action === "escalate") return <Badge tone="warning" className="whitespace-nowrap">{label}</Badge>;
  return <span className="whitespace-nowrap">{label}</span>;
}
