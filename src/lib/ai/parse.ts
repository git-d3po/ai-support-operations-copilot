import type { z } from "zod";

/**
 * Result of validating a model's raw output against one of our structured
 * schemas. Callers branch on `ok` rather than throwing, because a malformed
 * model response is an expected, handleable failure mode — not a bug.
 */
export type ParsedOutput<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; raw: unknown };

/**
 * Extract the first top-level JSON object/array from a string. Models
 * sometimes wrap JSON in prose or markdown code fences even when asked not
 * to; this recovers the payload without a full markdown parser.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) {
    throw new Error("No JSON object or array found in model output");
  }
  return JSON.parse(candidate.slice(start));
}

/**
 * Validate raw model output against a Zod schema, returning a typed result
 * instead of throwing. This is the single choke point every agent and
 * orchestrator step runs its output through before it becomes part of an
 * OrchestrationRun.
 */
export function parseStructuredOutput<Schema extends z.ZodTypeAny>(
  schema: Schema,
  rawText: string,
): ParsedOutput<z.infer<Schema>> {
  let json: unknown;
  try {
    json = extractJson(rawText);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to parse JSON",
      raw: rawText,
    };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
      raw: json,
    };
  }

  return { ok: true, data: result.data };
}

/**
 * Run an async model call and validate its output, retrying with feedback
 * about the previous failure appended to the prompt. Used by every agent so
 * transient malformed-JSON responses don't surface as user-facing errors.
 */
export async function callWithStructuredRetry<Schema extends z.ZodTypeAny>(
  schema: Schema,
  call: (retryContext?: string) => Promise<string>,
  maxAttempts = 2,
): Promise<ParsedOutput<z.infer<Schema>>> {
  let lastError: ParsedOutput<z.infer<Schema>> | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const retryContext =
      attempt === 1
        ? undefined
        : `Your previous response was invalid: ${lastError?.ok === false ? lastError.error : "unknown error"}. Return only valid JSON matching the required schema.`;

    const rawText = await call(retryContext);
    const parsed = parseStructuredOutput(schema, rawText);
    if (parsed.ok) return parsed;
    lastError = parsed;
  }

  return lastError!;
}
