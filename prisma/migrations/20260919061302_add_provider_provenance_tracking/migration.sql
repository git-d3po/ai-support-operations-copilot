-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orchestrationRunId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "finding" JSONB,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "estimatedCostUsd" REAL,
    "errorMessage" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "AgentInvocation_orchestrationRunId_fkey" FOREIGN KEY ("orchestrationRunId") REFERENCES "OrchestrationRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AgentInvocation" ("agentKey", "errorMessage", "estimatedCostUsd", "finding", "finishedAt", "id", "inputTokens", "latencyMs", "model", "orchestrationRunId", "outputTokens", "startedAt", "status") SELECT "agentKey", "errorMessage", "estimatedCostUsd", "finding", "finishedAt", "id", "inputTokens", "latencyMs", "model", "orchestrationRunId", "outputTokens", "startedAt", "status" FROM "AgentInvocation";
DROP TABLE "AgentInvocation";
ALTER TABLE "new_AgentInvocation" RENAME TO "AgentInvocation";
CREATE INDEX "AgentInvocation_orchestrationRunId_idx" ON "AgentInvocation"("orchestrationRunId");
CREATE TABLE "new_EvaluationResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evaluationCaseId" TEXT NOT NULL,
    "orchestrationRunId" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationResult_evaluationCaseId_fkey" FOREIGN KEY ("evaluationCaseId") REFERENCES "EvaluationCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EvaluationResult" ("createdAt", "evaluationCaseId", "id", "orchestrationRunId", "passed", "scores") SELECT "createdAt", "evaluationCaseId", "id", "orchestrationRunId", "passed", "scores" FROM "EvaluationResult";
DROP TABLE "EvaluationResult";
ALTER TABLE "new_EvaluationResult" RENAME TO "EvaluationResult";
CREATE INDEX "EvaluationResult_evaluationCaseId_idx" ON "EvaluationResult"("evaluationCaseId");
CREATE TABLE "new_OrchestrationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "classification" JSONB,
    "resolution" JSONB,
    "escalation" JSONB,
    "response" JSONB,
    "errorMessage" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "OrchestrationRun_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_OrchestrationRun" ("classification", "errorMessage", "escalation", "finishedAt", "id", "resolution", "response", "startedAt", "status", "ticketId") SELECT "classification", "errorMessage", "escalation", "finishedAt", "id", "resolution", "response", "startedAt", "status", "ticketId" FROM "OrchestrationRun";
DROP TABLE "OrchestrationRun";
ALTER TABLE "new_OrchestrationRun" RENAME TO "OrchestrationRun";
CREATE INDEX "OrchestrationRun_ticketId_idx" ON "OrchestrationRun"("ticketId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
