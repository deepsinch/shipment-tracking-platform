import { describe, expect, it } from "vitest";

import { shipmentEventTitle } from "./shipment-event";

describe("shipmentEventTitle", () => {
  it("names the event after what happened", () => {
    expect(shipmentEventTitle("created", "created")).toBe("Shipment created");
    expect(shipmentEventTitle("status_changed", "out_for_delivery")).toBe("Out for delivery");
    expect(shipmentEventTitle("status_changed", null)).toBe("Status changed");
  });
});
