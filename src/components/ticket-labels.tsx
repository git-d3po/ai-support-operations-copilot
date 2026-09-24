import { Badge } from "@/components/ui/Badge";
import { labelPriority, labelTicketStatus } from "@/lib/labels";

/**
 * Ticket status and priority as shown everywhere a ticket is (inbox and ticket
 * detail), so the two never disagree. Only the values an operator must notice
 * get a color; the rest stay plain text so a column doesn't turn into a wall
 * of color. Tones come from the shared semantic map (src/components/ui/tone.ts).
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
