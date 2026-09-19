import Link from "next/link";
import { db } from "@/lib/db";
import type { EvaluationExpectedOutcome } from "@/lib/ai/schemas";

export const dynamic = "force-dynamic";

export default async function EvaluationsPage() {
  const cases = await db.evaluationCase.findMany({
    include: { ticket: true, results: true },
    orderBy: { scenarioKey: "asc" },
  });

  return (
    <div className="p-6">
      <h1 className="text-lg font-semibold">Evaluations</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {cases.length} curated scenarios with known expected outcomes. No
        orchestrator runs have been scored yet — running the evaluation
        suite against the orchestrator is Phase 2 (see EVALUATION.md).
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
            <th className="py-2 pr-4">Results</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((evalCase) => {
            const expected = evalCase.expectedOutcome as unknown as EvaluationExpectedOutcome;
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
                <td className="py-2 pr-4 text-zinc-400">
                  {evalCase.results.length === 0 ? "not run" : `${evalCase.results.length} run(s)`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
