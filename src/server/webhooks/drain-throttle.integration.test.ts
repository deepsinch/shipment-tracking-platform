import { describe, expect, it } from "vitest";

import { claimWebhookDrain, DRAIN_INTERVAL_MS } from "./drain-throttle";

describe("claimWebhookDrain", () => {
  // The clock is one shared row: each test works in its own century so none sees another's claim.
  it("lets one caller through per interval", async () => {
    const t0 = new Date("2201-01-01T00:00:00Z");
    expect(await claimWebhookDrain(t0)).toBe(true);
    expect(await claimWebhookDrain(new Date(t0.getTime() + DRAIN_INTERVAL_MS - 1))).toBe(false);
    expect(await claimWebhookDrain(new Date(t0.getTime() + DRAIN_INTERVAL_MS))).toBe(true);
  });

  it("lets exactly one of many simultaneous callers through", async () => {
    const t0 = new Date("2301-01-01T00:00:00Z");
    const results = await Promise.all(Array.from({ length: 12 }, () => claimWebhookDrain(t0)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
