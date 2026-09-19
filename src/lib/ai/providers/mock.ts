import type { CompletionRequest, CompletionResult, ModelProvider } from "./types";

/**
 * A deterministic, network-free provider used in tests. It exists so that
 * "unit tests must have no network" (CLAUDE.md) stays true once agents
 * make real model calls in Phase 2 — tests register a MockProvider and
 * point routing config at it instead of hitting Anthropic.
 */
export class MockProvider implements ModelProvider {
  readonly key = "mock";

  constructor(
    private readonly respond:
      | CompletionResult
      | ((request: CompletionRequest) => CompletionResult),
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    return typeof this.respond === "function" ? this.respond(request) : this.respond;
  }
}
