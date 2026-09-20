import { findDemoRecordingBySubject } from "@/lib/demo/recordings";
import { DEMO_PROVIDER_KEY } from "./provenance";
import type { CompletionRequest, CompletionResult, ModelProvider } from "./types";

/**
 * Raised for anything the provider has no recording for: an unknown ticket, or
 * a pipeline step the scenario's recording does not include. The provider
 * never invents fallback content.
 */
export class DemoRecordingNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoRecordingNotFoundError";
  }
}

/**
 * Public Demo Mode's model provider: a deterministic replay of the scripted
 * responses in `src/lib/demo/recordings.ts`. It implements the same
 * `ModelProvider` interface as `AnthropicProvider`, so the orchestrator,
 * agents, routing, resolution and response guard run unchanged and only the
 * model call itself is replaced.
 *
 * Properties, each covered by a test:
 * - deterministic: the same ticket and pipeline step always return the same
 *   text (a pure lookup, no clock, no randomness);
 * - no network and no SDK: it imports nothing from `@anthropic-ai/sdk` and
 *   needs no API key;
 * - reports itself honestly: `key === "demo"`, which `provenance.ts` treats as
 *   simulated, so runs it serves are persisted with `isSimulated = true`;
 * - reports zero tokens, because no model was called (so estimated cost is 0).
 *
 * It recognizes the ticket from the "Ticket: <subject>" line every pipeline
 * prompt carries, exactly as the evaluation dry-run harness does.
 *
 * Not a general fixture: it serves only the curated scenarios, and is what the
 * retired test-only e2e provider was not (that one answered every ticket with
 * one ticket's analysis). See DECISIONS.md ("Public Demo Mode").
 */
export class DemoProvider implements ModelProvider {
  readonly key = DEMO_PROVIDER_KEY;

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const task = request.system?.match(/^TASK: (\S+)/)?.[1];
    if (!task) {
      throw new DemoRecordingNotFoundError("Demo Mode could not identify the pipeline step for this request.");
    }

    const userMessage = request.messages.at(-1)?.content ?? "";
    const subject = userMessage.match(/^Ticket(?: subject\/summary)?: (.+)$/m)?.[1];
    if (!subject) {
      throw new DemoRecordingNotFoundError("Demo Mode could not identify the ticket for this request.");
    }

    const found = findDemoRecordingBySubject(subject);
    if (!found) {
      throw new DemoRecordingNotFoundError(
        `No demo recording for the ticket "${subject.trim()}". Demo Mode runs the curated evaluation scenarios only.`,
      );
    }

    const text = found.recording.responses[task];
    if (text === undefined) {
      throw new DemoRecordingNotFoundError(
        `The demo recording for "${found.scenarioKey}" has no response for the "${task}" step.`,
      );
    }

    return { text, inputTokens: 0, outputTokens: 0 };
  }
}
