import { describe, expect, it } from "vitest";
import { createRng } from "@/lib/synthetic/rng";

describe("createRng", () => {
  it("is deterministic: same seed produces the same sequence", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a.float());
    const seqB = Array.from({ length: 20 }, () => b.float());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a.float());
    const seqB = Array.from({ length: 10 }, () => b.float());
    expect(seqA).not.toEqual(seqB);
  });

  it("int() stays within [min, max] inclusive", () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const n = rng.int(3, 8);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(8);
    }
  });

  it("pick() only returns items from the input array", () => {
    const rng = createRng(9);
    const items = ["a", "b", "c"];
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it("weighted() respects zero-weight exclusion", () => {
    const rng = createRng(11);
    for (let i = 0; i < 100; i++) {
      expect(rng.weighted([["a", 1], ["b", 0]])).toBe("a");
    }
  });

  it("shuffle() returns a permutation, not a mutation of the input", () => {
    const rng = createRng(13);
    const items = [1, 2, 3, 4, 5];
    const shuffled = rng.shuffle(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(shuffled.sort()).toEqual(items.sort());
  });
});
