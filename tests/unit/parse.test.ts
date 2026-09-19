import { describe, expect, it } from "vitest";
import { z } from "zod";
import { callWithStructuredRetry, extractJson, parseStructuredOutput } from "@/lib/ai/parse";

const Schema = z.object({ name: z.string(), score: z.number() });

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
  });

  it("extracts JSON from a markdown code fence", () => {
    expect(extractJson('Here is the result:\n```json\n{"a": 1}\n```\nDone.')).toEqual({ a: 1 });
  });

  it("extracts JSON preceded by prose with no fence", () => {
    expect(extractJson('Sure, here you go: {"a": 1}')).toEqual({ a: 1 });
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("parseStructuredOutput", () => {
  it("returns ok:true for valid, schema-conforming output", () => {
    const result = parseStructuredOutput(Schema, '{"name": "billing", "score": 0.8}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.name).toBe("billing");
    }
  });

  it("returns ok:false with a readable error for malformed JSON", () => {
    const result = parseStructuredOutput(Schema, "not json");
    expect(result.ok).toBe(false);
  });

  it("returns ok:false with a readable error for schema violations", () => {
    const result = parseStructuredOutput(Schema, '{"name": "billing", "score": "high"}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("score");
    }
  });
});

describe("callWithStructuredRetry", () => {
  it("succeeds on the first attempt without retrying", async () => {
    let calls = 0;
    const result = await callWithStructuredRetry(Schema, async () => {
      calls++;
      return '{"name": "ok", "score": 1}';
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("retries once after a malformed first response and succeeds", async () => {
    let calls = 0;
    const result = await callWithStructuredRetry(Schema, async (retryContext) => {
      calls++;
      if (calls === 1) {
        expect(retryContext).toBeUndefined();
        return "not json";
      }
      expect(retryContext).toContain("invalid");
      return '{"name": "ok", "score": 1}';
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("gives up after maxAttempts and returns the last failure", async () => {
    const result = await callWithStructuredRetry(Schema, async () => "not json", 2);
    expect(result.ok).toBe(false);
  });
});
