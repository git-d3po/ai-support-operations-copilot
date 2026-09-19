import Anthropic from "@anthropic-ai/sdk";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
} from "./types";

/**
 * The only file in the codebase allowed to import `@anthropic-ai/sdk`.
 * Everything else — agents, the orchestrator, modelClient.ts — talks to
 * `ModelProvider`, not to this class or its types directly.
 */
export class AnthropicProvider implements ModelProvider {
  readonly key = "anthropic";
  #client: Anthropic | undefined;

  private get client(): Anthropic {
    if (!this.#client) {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY is not set. Add it to .env — see .env.example.",
        );
      }
      this.#client = new Anthropic({ apiKey });
    }
    return this.#client;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const response = await this.client.messages.create({
      model: request.model,
      system: request.system,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}
