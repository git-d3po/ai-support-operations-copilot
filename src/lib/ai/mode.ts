/**
 * Which way the app answers "Run AI analysis": `live` (the real configured
 * model provider, the default) or `demo` (deterministic scripted replay, no
 * model and no API key). Chosen by the server-only `AI_MODE` environment
 * variable, read at call time.
 *
 * Deliberately:
 * - unset (or blank) means `live`, so every existing local and evaluation
 *   workflow behaves exactly as before; a public deployment opts in with
 *   `AI_MODE=demo`;
 * - any other value is an error, never silently treated as `live`: a typo
 *   such as `AI_MODE=Demo` must fail loudly, not quietly reach a paid provider;
 * - it is read only on the server and is never exposed as `NEXT_PUBLIC_*`, so
 *   a visitor cannot influence it.
 *
 * This file has no imports on purpose, so scripts can use it before the
 * database client is configured. See DECISIONS.md ("Public Demo Mode").
 */
export type AiMode = "live" | "demo";

export class InvalidAiModeError extends Error {
  constructor(value: string) {
    super(`Invalid AI_MODE "${value}". Use AI_MODE=demo or AI_MODE=live, or leave it unset (live).`);
    this.name = "InvalidAiModeError";
  }
}

export function getAiMode(env: Record<string, string | undefined> = process.env): AiMode {
  const raw = env.AI_MODE?.trim();
  if (raw === undefined || raw === "") return "live";
  if (raw === "live" || raw === "demo") return raw;
  throw new InvalidAiModeError(raw);
}

export function isDemoMode(env: Record<string, string | undefined> = process.env): boolean {
  return getAiMode(env) === "demo";
}

/**
 * Used by the evaluation runner. Demo recordings are scripted, so an
 * evaluation run under `AI_MODE=demo` would produce results that look like a
 * measurement and are not. Refuse rather than record them.
 */
export function assertLiveModeForEvaluation(env: Record<string, string | undefined> = process.env): void {
  if (getAiMode(env) === "demo") {
    throw new Error(
      "AI_MODE=demo is set, so the evaluation suite will not run. Demo Mode replays scripted responses and must " +
        "never be mistaken for a live-model evaluation. Unset AI_MODE (or set AI_MODE=live) and provide " +
        "ANTHROPIC_API_KEY to run the evaluation.",
    );
  }
}
