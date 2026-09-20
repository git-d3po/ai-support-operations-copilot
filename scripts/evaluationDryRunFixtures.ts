/**
 * Canned, deterministic responses for ALL 11 curated scenarios — used ONLY
 * by scripts/runEvaluationDryRun.ts to validate that the evaluation
 * pipeline (orchestrator → persistence → scorer → UI) is wired correctly
 * end to end, without a live model. This is NOT a claim about real model
 * behavior for any scenario; see DECISIONS.md ("Evaluation dry-run
 * fixture: validating the harness, not the model").
 *
 * The correct answers are NOT defined here: they are derived from the shared
 * scripted recordings in src/lib/demo/recordings.ts, which public Demo Mode
 * also uses, so there is one source of truth (see DECISIONS.md, "Public Demo
 * Mode"). Only the deliberate mutation below lives in this file.
 *
 * 10 of the 11 scenarios are answered "correctly" (matching their
 * expectedOutcome) so a clean pipeline run produces 10 passes. ONE
 * scenario (known-technical-issue) is deliberately answered WRONG on
 * purpose, to prove the scorer actually detects and reports a failure
 * end-to-end through the real runner — not just in isolated unit tests.
 * See the comment on that scenario below.
 */
import { SCENARIOS } from "../prisma/data/scenarios";
import { DEMO_RECORDINGS } from "../src/lib/demo/recordings";

const subjectToScenarioKey = new Map(SCENARIOS.map((s) => [s.ticket.subject, s.key]));

export function scenarioKeyForTicketSummary(userMessage: string): string | null {
  const match = userMessage.match(/^Ticket(?: subject\/summary)?: (.+)$/m);
  if (!match) return null;
  return subjectToScenarioKey.get(match[1].trim()) ?? null;
}

export function taskForSystemPrompt(system: string | undefined): string | null {
  return system?.match(/^TASK: (\S+)/)?.[1] ?? null;
}

type Fixtures = Record<string, Record<string, string>>;

/**
 * The deliberately wrong answer for `known-technical-issue`. It is layered over
 * the shared recordings below and is the ONLY place this wrong answer exists;
 * Demo Mode never serves it.
 */
const KNOWN_TECHNICAL_ISSUE_DELIBERATELY_WRONG: Record<string, string> = {
  // DELIBERATELY WRONG — see the file header comment. The real ticket
  // clearly matches the documented large-board automation-timeout known
  // issue (technical_issue, expects [technical, response] ->
  // reply_and_close). This fixture instead misclassifies it as a
  // billing question and routes to Billing with a low-confidence,
  // no-issue-found finding, which resolveOutcome() correctly resolves
  // to "reply_and_monitor" — NOT the expected "reply_and_close". This
  // proves scoreOutcome() reports classificationCorrect=false,
  // routingCorrect=false, and resolutionCorrect=false through the real
  // runner + scorer, not just in an isolated unit test.
  ticket_classification: JSON.stringify({
    intent: "billing_question",
    domains: ["billing"],
    sentiment: "neutral",
    confidence: 0.6,
    summary: "Deliberately incorrect classification for evaluation dry-run regression coverage.",
    keyEvidence: ["INTENTIONAL MISCLASSIFICATION — see evaluationDryRunFixtures.ts"],
  }),
  billing_agent_finding: JSON.stringify({
    agentKey: "billing",
    summary: "No billing issue found on this account.",
    evidence: ["One succeeded charge, on schedule"],
    confidence: 0.3,
    policyReferences: [],
    flags: ["no_billing_issue_found"],
  }),
  response_agent_reply: JSON.stringify({
    body: "Thanks for reaching out — we're looking into this and will follow up shortly.",
    tone: "neutral",
    nextSteps: [],
  }),
};

/**
 * FIXTURES[scenarioKey][task] = canned JSON response.
 *
 * Only tasks that scenario's expected agent roster actually calls need an
 * entry — if the dry run somehow calls a task/scenario pair with no entry
 * here (e.g. a routing bug sends a ticket to an agent nobody expected),
 * the dry-run provider throws a clear error rather than guessing, which
 * itself would be a real finding.
 */
export const FIXTURES: Fixtures = {
  ...Object.fromEntries(Object.entries(DEMO_RECORDINGS).map(([scenarioKey, recording]) => [scenarioKey, recording.responses])),
  "known-technical-issue": KNOWN_TECHNICAL_ISSUE_DELIBERATELY_WRONG,
};
