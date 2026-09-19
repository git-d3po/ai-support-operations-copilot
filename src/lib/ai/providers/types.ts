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

/** Output-token ceiling used when a caller doesn't set `maxTokens`. Sized
 * ~2x the largest structured artifact any pipeline step can emit (a Policy
 * or Response JSON, ~1k tokens worst case under schemas.ts's field caps) —
 * a ceiling, not a spend: only tokens actually generated are billed. See
 * DECISIONS.md ("Explicit output-token budget"). */
export const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

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
