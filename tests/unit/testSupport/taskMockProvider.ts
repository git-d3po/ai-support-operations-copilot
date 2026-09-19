import { MockProvider } from "@/lib/ai/providers/mock";
import type { CompletionRequest } from "@/lib/ai/providers/types";

/**
 * Every pipeline-step prompt starts with a stable "TASK: <name>" line (see
 * src/lib/orchestrator/prompts.ts, buildSystemPrompt). This dispatches a
 * canned response by that marker, so one MockProvider instance can stand
 * in for the single "anthropic" provider key that every step's routing
 * config points at, while still returning the right shape for whichever
 * step is actually calling.
 */
export function extractTask(system: string | undefined): string | null {
  const match = system?.match(/^TASK: (\S+)/);
  return match ? match[1] : null;
}

export type TaskResponses = Record<
  string,
  string | ((request: CompletionRequest) => string) | (string | ((request: CompletionRequest) => string))[]
>;

/**
 * `responses[task]` can be a single canned response (reused for every call
 * to that task) or an array (consumed in order, one per call — useful for
 * testing retry-after-malformed-output behavior).
 */
export function createTaskMockProvider(responses: TaskResponses): MockProvider {
  const callIndexByTask = new Map<string, number>();

  return new MockProvider((request: CompletionRequest) => {
    const task = extractTask(request.system);
    const entry = task ? responses[task] : undefined;
    if (!entry) {
      throw new Error(`createTaskMockProvider: no response configured for task "${task}"`);
    }

    let text: string;
    if (Array.isArray(entry)) {
      const index = callIndexByTask.get(task!) ?? 0;
      callIndexByTask.set(task!, index + 1);
      const item = entry[Math.min(index, entry.length - 1)];
      text = typeof item === "function" ? item(request) : item;
    } else {
      text = typeof entry === "function" ? entry(request) : entry;
    }

    return { text, inputTokens: 10, outputTokens: 10 };
  });
}
