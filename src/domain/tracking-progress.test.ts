import { describe, expect, it } from "vitest";

import { DELIVERY_STEPS, trackingProgress } from "./tracking-progress";

describe("trackingProgress", () => {
  it("follows the normal delivery path", () => {
    DELIVERY_STEPS.slice(0, -1).forEach((status, index) => {
      expect(trackingProgress(status, DELIVERY_STEPS.slice(0, index + 1))).toEqual({
        stepIndex: index,
        state: "on_track",
      });
    });
  });

  it("marks delivery as the last step", () => {
    expect(trackingProgress("delivered", DELIVERY_STEPS)).toEqual({
      stepIndex: 4,
      state: "delivered",
    });
  });

  it("keeps the progress reached before an exception", () => {
    expect(
      trackingProgress("exception", ["created", "picked_up", "in_transit", "exception"]),
    ).toEqual({ stepIndex: 2, state: "exception" });
  });

  it("follows the current status after resuming from an exception", () => {
    expect(
      trackingProgress("out_for_delivery", [
        "created",
        "picked_up",
        "exception",
        "out_for_delivery",
      ]),
    ).toEqual({ stepIndex: 3, state: "on_track" });
  });

  it("reports cancellation with the progress reached", () => {
    expect(trackingProgress("cancelled", ["created", "cancelled"])).toEqual({
      stepIndex: 0,
      state: "cancelled",
    });
  });

  it("ignores events without a status", () => {
    expect(trackingProgress("exception", [null, "created", "exception"])).toEqual({
      stepIndex: 0,
      state: "exception",
    });
  });
});
