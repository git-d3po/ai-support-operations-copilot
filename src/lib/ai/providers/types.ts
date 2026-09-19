/**
 * The one interface every model provider implements. Agents and the
 * orchestrator depend only on this — never on a provider SDK directly —
 * so switching or adding a provider never touches agent logic or the
 * orchestration flow. See DECISIONS.md ("Model provider abstraction").
 */

export interface ModelMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  /** Provider-specific model id (e.g. "claude-sonnet-5"). Which id to use
   * for a given agent comes from modelRouting.ts, not from the caller. */
  model: string;
  system?: string;
  messages: ModelMessage[];
  maxTokens?: number;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelProvider {
  readonly key: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
