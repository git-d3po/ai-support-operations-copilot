/**
 * Exports a recorded live evaluation from its local evaluation database into a
 * committed JSON record, or checks that a committed record still matches its
 * source. See DECISIONS.md ("Recorded live evaluation shipped as a verified
 * snapshot").
 *
 *   npx tsx scripts/exportEvaluationSnapshot.ts <source-db> <snapshot.json>
 *   npx tsx scripts/exportEvaluationSnapshot.ts --check <source-db> <snapshot.json>
 *
 * Read-only toward the evidence, by construction:
 * - The source file's SHA-256 must be one this script knows (KNOWN_SOURCES):
 *   a record is only ever made from an identified, unmodified run database.
 * - It reads a temporary copy of that file, opened read-only, and confirms the
 *   original's checksum is unchanged afterwards.
 * - It never runs an evaluation, never calls the scorer and never calls a model:
 *   every value is read from rows the run already wrote. The derivation and
 *   its refusals are in src/lib/evaluation/recordedEvaluationContract.ts.
 *
 * `--check` regenerates the record in memory and compares it byte for byte with
 * the committed file, exiting non-zero on any difference; it never writes.
 *
 * Needs the local git history (for the evaluated commit's pass threshold) and
 * the source database, which is gitignored and never committed, so it is
 * maintainer tooling, not part of the test suite or the application.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { SCENARIOS } from "../prisma/data/scenarios";
import {
  deriveRecordedEvaluation,
  serializeRecordedEvaluation,
  type RecordedEvaluationSource,
} from "../src/lib/evaluation/recordedEvaluationContract";

/**
 * The run databases a record may be made from, by SHA-256, with the provenance
 * the database itself does not store: the commit the run evaluated, recorded in
 * DECISIONS.md ("Live evaluation refresh on a separate database"). Adding a
 * future run means adding its file here deliberately, never editing an entry.
 */
const KNOWN_SOURCES: Record<string, { database: string; codeCommit: string }> = {
  fe390b73aa58eb580b3711288a424911ad8bbdf7fac46bbc9501a94e73e5d19f: { database: "eval-2026-09-24.db", codeCommit: "0a12bb9" },
};

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** The pass threshold as it was at the evaluated commit, read from that commit's runner. */
function passThresholdAt(commit: string): number {
  const runner = git("show", `${commit}:src/lib/evaluation/runEvaluation.ts`);
  const match = runner.match(/export const PASS_THRESHOLD = (\d+(?:\.\d+)?);/);
  if (!match) throw new Error(`Could not read PASS_THRESHOLD at ${commit}.`);
  return Number(match[1]);
}

async function readSource(copy: string): Promise<RecordedEvaluationSource> {
  // Read-only and must exist: better-sqlite3 options, passed through by the Prisma adapter.
  const db = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${copy}`, readonly: true, fileMustExist: true }) });
  try {
    const [cases, results, runs, invocations] = await Promise.all([
      db.evaluationCase.findMany({ include: { ticket: { select: { subject: true } } } }),
      db.evaluationResult.findMany(),
      db.orchestrationRun.findMany(),
      db.agentInvocation.findMany(),
    ]);
    return {
      cases: cases.map((c) => ({ id: c.id, scenarioKey: c.scenarioKey, ticketSubject: c.ticket.subject, expectedOutcome: c.expectedOutcome })),
      results: results.map((r) => ({
        id: r.id,
        evaluationCaseId: r.evaluationCaseId,
        orchestrationRunId: r.orchestrationRunId,
        scores: r.scores,
        passed: r.passed,
        isSimulated: r.isSimulated,
        createdAt: r.createdAt,
      })),
      // Only runs a result scored: anything else in the file is not part of this evaluation.
      runs: runs
        .filter((run) => results.some((r) => r.orchestrationRunId === run.id))
        .map((run) => ({
          id: run.id,
          status: run.status,
          isSimulated: run.isSimulated,
          classification: run.classification,
          resolution: run.resolution,
          escalation: run.escalation,
        })),
      invocations: invocations
        .filter((inv) => results.some((r) => r.orchestrationRunId === inv.orchestrationRunId))
        .map((inv) => ({
          orchestrationRunId: inv.orchestrationRunId,
          agentKey: inv.agentKey,
          status: inv.status,
          finding: inv.finding,
          model: inv.model,
          provider: inv.provider,
          inputTokens: inv.inputTokens,
          outputTokens: inv.outputTokens,
          estimatedCostUsd: inv.estimatedCostUsd,
        })),
    };
  } finally {
    await db.$disconnect();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const check = args[0] === "--check";
  const [sourcePath, snapshotPath] = check ? args.slice(1) : args;
  if (!sourcePath || !snapshotPath || (check ? args.length !== 3 : args.length !== 2)) {
    throw new Error(
      "Usage: npx tsx scripts/exportEvaluationSnapshot.ts [--check] <source-db> <snapshot.json>",
    );
  }
  if (!existsSync(sourcePath)) throw new Error(`Source database not found: ${sourcePath}`);

  const checksumBefore = sha256(sourcePath);
  const known = KNOWN_SOURCES[checksumBefore];
  if (!known) {
    throw new Error(`Unknown source database (sha256 ${checksumBefore}). Only identified, unmodified run databases can be recorded.`);
  }

  // The evaluated commit must exist and predate the run.
  const commitTime = new Date(git("show", "-s", "--format=%cI", `${known.codeCommit}^{commit}`));
  const passThreshold = passThresholdAt(known.codeCommit);

  const workDir = mkdtempSync(path.join(tmpdir(), "recorded-evaluation-"));
  const copy = path.join(workDir, "source.db");
  let output: string;
  try {
    copyFileSync(sourcePath, copy);
    if (sha256(copy) !== checksumBefore) throw new Error("The temporary copy does not match the source database.");
    const source = await readSource(copy);
    const record = deriveRecordedEvaluation(
      source,
      { database: known.database, sha256: checksumBefore, codeCommit: known.codeCommit, passThreshold },
      SCENARIOS,
    );
    if (commitTime.getTime() > Date.parse(record.recordedAt.start)) {
      throw new Error(`Commit ${known.codeCommit} is later than the run it is recorded against.`);
    }
    output = serializeRecordedEvaluation(record);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  if (sha256(sourcePath) !== checksumBefore) {
    throw new Error("The source database changed while it was being read. Nothing was written.");
  }

  if (check) {
    const committed = existsSync(snapshotPath) ? readFileSync(snapshotPath, "utf8") : null;
    if (committed !== output) {
      console.error(`${snapshotPath} does not match ${known.database} (sha256 ${checksumBefore}).`);
      process.exitCode = 1;
      return;
    }
    console.log(`${snapshotPath} matches ${known.database} (sha256 ${checksumBefore}).`);
    return;
  }

  writeFileSync(snapshotPath, output);
  console.log(`Wrote ${snapshotPath} from ${known.database} (sha256 ${checksumBefore}).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
