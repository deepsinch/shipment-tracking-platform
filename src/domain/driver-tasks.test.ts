import { describe, expect, it } from "vitest";

import { isOverdue, nextStopFor, statusActionLabel } from "./driver-tasks";

describe("nextStopFor", () => {
  it("points to the pickup until the shipment is collected, then to the delivery", () => {
    expect(nextStopFor("created")).toBe("pickup");
    expect(nextStopFor("picked_up")).toBe("delivery");
    expect(nextStopFor("in_transit")).toBe("delivery");
    expect(nextStopFor("out_for_delivery")).toBe("delivery");
    expect(nextStopFor("exception")).toBe("delivery");
  });

  it("has no next stop for finished shipments", () => {
    expect(nextStopFor("delivered")).toBeNull();
    expect(nextStopFor("cancelled")).toBeNull();
  });
});

describe("statusActionLabel", () => {
  it("phrases each status as an action", () => {
    expect(statusActionLabel("picked_up")).toBe("Mark as picked up");
    expect(statusActionLabel("out_for_delivery")).toBe("Mark as out for delivery");
    expect(statusActionLabel("exception")).toBe("Report a problem");
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  const past = new Date("2026-10-31T11:00:00Z");
  const future = new Date("2026-10-31T13:00:00Z");

  it("flags active shipments past their promised delivery", () => {
    expect(isOverdue({ status: "in_transit", promisedDeliveryAt: past }, now)).toBe(true);
    expect(isOverdue({ status: "in_transit", promisedDeliveryAt: future }, now)).toBe(false);
    expect(isOverdue({ status: "created", promisedDeliveryAt: null }, now)).toBe(false);
  });

  it("never flags finished shipments", () => {
    expect(isOverdue({ status: "delivered", promisedDeliveryAt: past }, now)).toBe(false);
  });
});
