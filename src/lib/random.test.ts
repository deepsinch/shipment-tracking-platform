import { describe, expect, it } from "vitest";

import { createRandom } from "./random";

describe("createRandom", () => {
  it("repeats the same sequence for the same seed and differs for another", () => {
    const sequence = (seed: number) => {
      const random = createRandom(seed);
      return Array.from({ length: 5 }, () => random.next());
    };
    expect(sequence(7)).toEqual(sequence(7));
    expect(sequence(7)).not.toEqual(sequence(8));
  });

  it("stays within its ranges", () => {
    const random = createRandom(1);
    for (let i = 0; i < 1000; i++) {
      const value = random.between(2, 3);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(3);
      expect(["a", "b", "c"]).toContain(random.pick(["a", "b", "c"]));
    }
  });

  it("refuses to pick from an empty list", () => {
    expect(() => createRandom(1).pick([])).toThrow("empty");
  });
});
