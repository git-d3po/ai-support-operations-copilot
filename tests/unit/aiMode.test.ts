import { describe, expect, it } from "vitest";
import { assertLiveModeForEvaluation, getAiMode, InvalidAiModeError, isDemoMode } from "@/lib/ai/mode";

describe("getAiMode", () => {
  it("is live when AI_MODE is unset or blank, so existing workflows are unchanged", () => {
    expect(getAiMode({})).toBe("live");
    expect(getAiMode({ AI_MODE: undefined })).toBe("live");
    expect(getAiMode({ AI_MODE: "" })).toBe("live");
    expect(getAiMode({ AI_MODE: "   " })).toBe("live");
  });

  it("recognizes demo and live explicitly", () => {
    expect(getAiMode({ AI_MODE: "demo" })).toBe("demo");
    expect(getAiMode({ AI_MODE: "live" })).toBe("live");
    expect(getAiMode({ AI_MODE: " demo " })).toBe("demo"); // surrounding whitespace only
  });

  it.each(["Demo", "DEMO", "true", "1", "production", "dmeo", "demo,live", "off"])(
    "rejects the unknown value %j instead of silently treating it as live",
    (value) => {
      expect(() => getAiMode({ AI_MODE: value })).toThrow(InvalidAiModeError);
      expect(() => getAiMode({ AI_MODE: value })).toThrow(/AI_MODE/);
    },
  );

  it("reads process.env by default, at call time", () => {
    const original = process.env.AI_MODE;
    try {
      process.env.AI_MODE = "demo";
      expect(getAiMode()).toBe("demo");
      expect(isDemoMode()).toBe(true);
      delete process.env.AI_MODE;
      expect(getAiMode()).toBe("live");
      expect(isDemoMode()).toBe(false);
    } finally {
      if (original === undefined) delete process.env.AI_MODE;
      else process.env.AI_MODE = original;
    }
  });

  it("is only ever read from the server-side variable, never a NEXT_PUBLIC one", () => {
    expect(getAiMode({ NEXT_PUBLIC_AI_MODE: "demo" })).toBe("live");
  });
});

describe("assertLiveModeForEvaluation", () => {
  it("passes when live or unset", () => {
    expect(() => assertLiveModeForEvaluation({})).not.toThrow();
    expect(() => assertLiveModeForEvaluation({ AI_MODE: "live" })).not.toThrow();
  });

  it("refuses demo mode with an instruction to use live mode", () => {
    expect(() => assertLiveModeForEvaluation({ AI_MODE: "demo" })).toThrow(/AI_MODE=demo/);
    expect(() => assertLiveModeForEvaluation({ AI_MODE: "demo" })).toThrow(/Unset AI_MODE \(or set AI_MODE=live\)/);
    expect(() => assertLiveModeForEvaluation({ AI_MODE: "demo" })).toThrow(/scripted/);
  });

  it("refuses an invalid mode too", () => {
    expect(() => assertLiveModeForEvaluation({ AI_MODE: "Demo" })).toThrow(InvalidAiModeError);
  });
});
