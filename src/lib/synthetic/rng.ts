/**
 * Deterministic PRNG used for all synthetic-data generation decisions
 * (which status a record gets, how many invoices, which scenario a ticket
 * maps to, etc). Given the same seed, every run produces byte-identical
 * output — required so the app and the evaluation suite are reproducible.
 *
 * This is intentionally a small, dependency-free implementation (mulberry32)
 * rather than pulling in a PRNG library: we need exactly one property
 * (seeded, reproducible, uniform-enough) and full control over the algorithm
 * so behavior never changes out from under us on a dependency bump.
 */
export function createRng(seed: number) {
  let state = seed >>> 0;

  function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    /** Uniform float in [0, 1). */
    float(): number {
      return next();
    },
    /** Uniform integer in [min, max] inclusive. */
    int(min: number, max: number): number {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    /** True with the given probability (0-1). */
    chance(probability: number): boolean {
      return next() < probability;
    },
    /** Pick one element uniformly at random. */
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error("rng.pick: items must be non-empty");
      }
      return items[Math.floor(next() * items.length)];
    },
    /** Pick one element using relative weights, e.g. [["a", 3], ["b", 1]]. */
    weighted<T>(items: readonly (readonly [T, number])[]): T {
      const total = items.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = next() * total;
      for (const [item, weight] of items) {
        roll -= weight;
        if (roll <= 0) return item;
      }
      return items[items.length - 1][0];
    },
    /** Shuffle a copy of the array (Fisher-Yates). */
    shuffle<T>(items: readonly T[]): T[] {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    /** Deterministic date offset from an anchor, `daysAgo` in [minDays, maxDays]. */
    pastDate(anchor: Date, minDaysAgo: number, maxDaysAgo: number): Date {
      const days = this.int(minDaysAgo, maxDaysAgo);
      return new Date(anchor.getTime() - days * 24 * 60 * 60 * 1000);
    },
  };
}

export type Rng = ReturnType<typeof createRng>;

/** Fixed seed for the whole synthetic dataset — change deliberately, not casually. */
export const SEED = 20260101;
