import Link from "next/link";
import { db } from "@/lib/db";
import type { EvaluationExpectedOutcome, EvaluationResult } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

export default async function EvaluationsPage() {
  const cases = await db.evaluationCase.findMany({
    include: { ticket: true, results: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { scenarioKey: "asc" },
  });

  const scoredCases = cases.filter((c) => c.results.length > 0);
  const passedCount = scoredCases.filter((c) => (c.results[0] as { passed: boolean }).passed).length;

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Evaluations</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {cases.length} curated scenarios with known expected outcomes (see EVALUATION.md).
        {scoredCases.length === 0
          ? " No evaluation runs have been scored yet — run `npm run eval` against a configured model provider to measure real orchestrator behavior."
          : ` ${scoredCases.length}/${cases.length} scenarios have been scored; ${passedCount}/${scoredCases.length} passed.`}
      </p>

      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
            <th className="py-2 pr-4">Scenario</th>
            <th className="py-2 pr-4">Ticket</th>
            <th className="py-2 pr-4">Expected intent</th>
            <th className="py-2 pr-4">Expected agents</th>
            <th className="py-2 pr-4">Expected escalation</th>
            <th className="py-2 pr-4">Expected action</th>
            <th className="py-2 pr-4">Result</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((evalCase) => {
            const expected = evalCase.expectedOutcome as unknown as EvaluationExpectedOutcome;
            const latestResult = evalCase.results[0] as { scores: unknown; passed: boolean } | undefined;
            const scores = latestResult?.scores as EvaluationResult | undefined;
            return (
              <tr key={evalCase.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-4 font-medium">{evalCase.scenarioKey}</td>
                <td className="py-2 pr-4">
                  <Link href={`/tickets/${evalCase.ticketId}`} className="hover:underline">
                    {evalCase.ticket.subject}
                  </Link>
                </td>
                <td className="py-2 pr-4">{expected.expectedIntent}</td>
                <td className="py-2 pr-4">{expected.expectedAgents.join(", ")}</td>
                <td className="py-2 pr-4">{expected.expectedEscalation ? "Yes" : "No"}</td>
                <td className="py-2 pr-4">{expected.expectedAction}</td>
                <td className="py-2 pr-4">
                  {!latestResult || !scores ? (
                    <span className="text-zinc-400">not run</span>
                  ) : (
                    <span
                      className={
                        latestResult.passed
                          ? "rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : "rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-300"
                      }
                      title={scores.notes}
                    >
                      {latestResult.passed ? "pass" : "fail"} ({scores.overallScore.toFixed(2)})
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-6 rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700">
        Dimensions scored per case: classification, routing, policy, escalation, and resolution
        correctness (exact match against the expected outcome), plus an evidence-quality heuristic. See
        EVALUATION.md for the full rubric and DECISIONS.md for why evaluation is scored this way.
      </div>
    </div>
  );
}
