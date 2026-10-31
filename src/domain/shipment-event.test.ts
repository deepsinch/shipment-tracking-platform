import { describe, expect, it } from "vitest";

import {
  driverAssignmentOf,
  driverAssignmentTitle,
  PUBLIC_SHIPMENT_EVENT_TYPES,
  shipmentEventTitle,
} from "./shipment-event";

describe("shipmentEventTitle", () => {
  it("names the event after what happened", () => {
    expect(shipmentEventTitle("created", "created")).toBe("Shipment created");
    expect(shipmentEventTitle("status_changed", "out_for_delivery")).toBe("Out for delivery");
    expect(shipmentEventTitle("status_changed", null)).toBe("Status changed");
    expect(shipmentEventTitle("driver_assigned", null)).toBe("Driver changed");
  });
});

describe("driverAssignmentTitle", () => {
  it("describes assigning, reassigning and unassigning", () => {
    expect(driverAssignmentTitle(null, "Bo")).toBe("Assigned to Bo");
    expect(driverAssignmentTitle("Ann", "Bo")).toBe("Reassigned from Ann to Bo");
    expect(driverAssignmentTitle("Ann", null)).toBe("Unassigned from Ann");
  });
});

describe("driverAssignmentOf", () => {
  it("reads the driver ids, treating anything else as no driver", () => {
    expect(driverAssignmentOf({ fromDriverId: null, toDriverId: "u1" })).toEqual({
      fromDriverId: null,
      toDriverId: "u1",
    });
    expect(driverAssignmentOf({ fromDriverId: 42 })).toEqual({
      fromDriverId: null,
      toDriverId: null,
    });
  });
});

describe("PUBLIC_SHIPMENT_EVENT_TYPES", () => {
  // Restated on purpose: making an event type public is a privacy decision, not a refactor.
  it("allows only customer-facing event types", () => {
    expect(PUBLIC_SHIPMENT_EVENT_TYPES).toEqual(["created", "status_changed"]);
  });
});
