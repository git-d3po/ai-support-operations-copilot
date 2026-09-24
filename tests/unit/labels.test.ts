import { describe, expect, it } from "vitest";
import {
  ESCALATION_TEAMS,
  KNOWN_AGENT_FLAGS,
  RESOLUTION_ACTIONS,
  TICKET_INTENTS,
} from "@/lib/ai/schemas";
import {
  ACCOUNT_PLAN_LABELS,
  ACCOUNT_STATUS_LABELS,
  ACTION_LABELS,
  AGENT_FLAG_LABELS,
  AGENT_LABELS,
  AGENT_SHORT_LABELS,
  CHANNEL_LABELS,
  INTENT_LABELS,
  INVOICE_STATUS_LABELS,
  INVOCATION_STATUS_LABELS,
  MESSAGE_AUTHOR_LABELS,
  POLICY_DECISION_LABELS,
  PRIORITY_LABELS,
  RESPONSE_TONE_LABELS,
  SENTIMENT_LABELS,
  SEVERITY_LABELS,
  TEAM_LABELS,
  TICKET_STATUS_LABELS,
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  PRIORITY_ORDER,
  TICKET_STATUS_ORDER,
  humanizeIdentifier,
  labelAction,
  labelAgentFlag,
  labelTeam,
  sortByDisplayOrder,
} from "@/lib/labels";

/**
 * The presentation-label contract (src/lib/labels.ts): every canonical value
 * the operator can see has a human label, no label leaks an identifier, and
 * labels never replace the canonical values themselves.
 */
const ALL_MAPS = {
  ACCOUNT_PLAN_LABELS,
  ACCOUNT_STATUS_LABELS,
  ACTION_LABELS,
  AGENT_FLAG_LABELS,
  AGENT_LABELS,
  AGENT_SHORT_LABELS,
  CHANNEL_LABELS,
  INTENT_LABELS,
  INVOICE_STATUS_LABELS,
  INVOCATION_STATUS_LABELS,
  MESSAGE_AUTHOR_LABELS,
  POLICY_DECISION_LABELS,
  PRIORITY_LABELS,
  RESPONSE_TONE_LABELS,
  SENTIMENT_LABELS,
  SEVERITY_LABELS,
  TEAM_LABELS,
  TICKET_STATUS_LABELS,
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
};

describe("label maps", () => {
  it("cover every value of the schema taxonomies the UI shows", () => {
    expect(Object.keys(INTENT_LABELS).sort()).toEqual([...TICKET_INTENTS].sort());
    expect(Object.keys(ACTION_LABELS).sort()).toEqual([...RESOLUTION_ACTIONS].sort());
    expect(Object.keys(TEAM_LABELS).sort()).toEqual([...ESCALATION_TEAMS].sort());
    expect(Object.keys(AGENT_FLAG_LABELS).sort()).toEqual(Object.values(KNOWN_AGENT_FLAGS).sort());
  });

  it("never show an identifier as a label: no underscores, and each starts with a capital", () => {
    for (const [mapName, map] of Object.entries(ALL_MAPS)) {
      for (const [key, label] of Object.entries(map)) {
        expect(label, `${mapName}.${key}`).not.toMatch(/_/);
        expect(label.charAt(0), `${mapName}.${key}`).toBe(label.charAt(0).toUpperCase());
      }
    }
  });

  it("uses the product's names for the examples called out in review", () => {
    expect(labelAction("refund_customer")).toBe("Refund customer");
    expect(labelTeam("trust_and_safety")).toBe("Trust & Safety");
    expect(INTENT_LABELS.account_security).toBe("Account security");
  });
});

describe("fallbacks for values without an explicit label", () => {
  it("humanize an identifier rather than render it raw", () => {
    expect(humanizeIdentifier("past_due")).toBe("Past due");
    expect(humanizeIdentifier("some-kebab-value")).toBe("Some kebab value");
    expect(labelAgentFlag("an_informational_flag")).toBe("An informational flag");
  });

  it("do not match inherited object properties", () => {
    expect(labelAction("toString")).toBe("ToString");
  });
});

describe("display order for ticket statuses and priorities", () => {
  it("covers exactly the labeled values", () => {
    expect([...TICKET_STATUS_ORDER].sort()).toEqual(Object.keys(TICKET_STATUS_LABELS).sort());
    expect([...PRIORITY_ORDER].sort()).toEqual(Object.keys(PRIORITY_LABELS).sort());
  });

  it("puts statuses in workflow order and priorities most urgent first, not alphabetically", () => {
    const byStatus = sortByDisplayOrder(
      ["closed", "escalated", "open", "pending", "resolved"].map((status) => ({ status })),
      (row) => row.status,
      TICKET_STATUS_ORDER,
    );
    expect(byStatus.map((row) => row.status)).toEqual(["open", "pending", "escalated", "resolved", "closed"]);
    const byPriority = sortByDisplayOrder(["high", "low", "medium", "urgent"], (p) => p, PRIORITY_ORDER);
    expect(byPriority).toEqual(["urgent", "high", "medium", "low"]);
  });

  it("keeps an unknown value, after the known ones, and does not mutate its input", () => {
    const input = ["zeta", "low", "alpha", "urgent"];
    expect(sortByDisplayOrder(input, (p) => p, PRIORITY_ORDER)).toEqual(["urgent", "low", "alpha", "zeta"]);
    expect(input).toEqual(["zeta", "low", "alpha", "urgent"]);
  });
});
