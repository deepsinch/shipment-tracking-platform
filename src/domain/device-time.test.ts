import { describe, expect, it } from "vitest";

import { isTooFarInFuture, MAX_CLOCK_SKEW_MS } from "./device-time";

describe("isTooFarInFuture", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

  it("accepts past times and device clocks up to the allowed skew ahead", () => {
    expect(isTooFarInFuture(at(-60 * 60_000), now)).toBe(false);
    expect(isTooFarInFuture(now, now)).toBe(false);
    expect(isTooFarInFuture(at(MAX_CLOCK_SKEW_MS), now)).toBe(false);
  });

  it("rejects times beyond the allowed skew", () => {
    expect(isTooFarInFuture(at(MAX_CLOCK_SKEW_MS + 1), now)).toBe(true);
  });
});
