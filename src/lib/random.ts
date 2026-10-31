/**
 * A small deterministic PRNG (mulberry32), so seeded data and simulator runs are reproducible.
 * Not for anything secret: tracking codes use `crypto.getRandomValues`.
 */
export type Random = {
  /** A float in [0, 1). */
  next: () => number;
  /** A float in [min, max). */
  between: (min: number, max: number) => number;
  /** One of `items`, uniformly. */
  pick: <T>(items: readonly T[]) => T;
  /** True with the given probability. */
  chance: (probability: number) => boolean;
};

export function createRandom(seed: number): Random {
  let state = seed | 0;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    between: (min, max) => min + next() * (max - min),
    pick: (items) => {
      if (items.length === 0) throw new Error("Cannot pick from an empty list");
      return items[Math.floor(next() * items.length)]!;
    },
    chance: (probability) => next() < probability,
  };
}
