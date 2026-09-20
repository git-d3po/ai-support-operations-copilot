/**
 * Run as a child process by tests/integration/demoDeployment.test.ts, with
 * DATABASE_URL pointing at a freshly initialized scratch database, AI_MODE=demo
 * and no ANTHROPIC_API_KEY (a child process, because src/lib/db.ts binds to
 * DATABASE_URL at import time). Exercises the deployed path exactly as the
 * server action does, through requestAnalysis(), and prints one JSON line.
 */
import { db } from "@/lib/db";
import { requestAnalysis } from "@/lib/orchestrator/requestAnalysis";

async function main() {
  const curated = await db.ticket.findFirstOrThrow({ where: { scenarioKey: "duplicate-billing" } });
  const uncurated = await db.ticket.findFirstOrThrow({ where: { scenarioKey: null } });

  const first = await requestAnalysis(curated.id);
  const second = await requestAnalysis(curated.id);
  const blocked = await requestAnalysis(uncurated.id);

  const runs = await db.orchestrationRun.findMany({ include: { agentInvocations: true } });
  console.log(
    JSON.stringify({
      hadApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
      first,
      second,
      blocked,
      runCount: runs.length,
      uncuratedRunCount: await db.orchestrationRun.count({ where: { ticketId: uncurated.id } }),
      runs: runs.map((run) => ({
        status: run.status,
        isSimulated: run.isSimulated,
        providers: [...new Set(run.agentInvocations.map((invocation) => invocation.provider))],
      })),
    }),
  );
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
