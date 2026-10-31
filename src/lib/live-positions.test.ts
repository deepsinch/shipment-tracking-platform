import { describe, expect, it } from "vitest";

import {
  applyPositionEvent,
  isUnknownShipment,
  mergeFleet,
  newerFix,
  sortFleetForList,
  type FleetShipment,
  type LiveFixes,
} from "./live-positions";
import type { PositionEvent } from "./realtime-events";

const shipment = (overrides: Partial<FleetShipment> = {}): FleetShipment => ({
  shipmentId: "s-1",
  trackingCode: "WB-AAAA-AAAA",
  status: "in_transit",
  destinationCity: "Antwerp",
  destinationCountry: "BE",
  lat: 51.9,
  lng: 4.5,
  recordedAt: "2026-10-31T12:00:00.000Z",
  ...overrides,
});

const position = (overrides: Partial<PositionEvent> = {}): PositionEvent => ({
  kind: "position",
  shipmentId: "s-1",
  lat: 51.5,
  lng: 4.6,
  recordedAt: "2026-10-31T12:00:30.000Z",
  ...overrides,
});

describe("newerFix", () => {
  const early = { lat: 1, lng: 1, recordedAt: "2026-10-31T12:00:00Z" };
  const late = { lat: 2, lng: 2, recordedAt: "2026-10-31T12:00:10Z" };

  it("picks the later device time in either order", () => {
    expect(newerFix(early, late)).toBe(late);
    expect(newerFix(late, early)).toBe(late);
  });

  it("keeps the current fix on a tie and handles missing fixes", () => {
    const twin = { ...early, lat: 9 };
    expect(newerFix(early, twin)).toBe(early);
    expect(newerFix(null, early)).toBe(early);
    expect(newerFix(early, null)).toBe(early);
    expect(newerFix(null, null)).toBeNull();
  });
});

describe("applyPositionEvent", () => {
  it("records the first fix for a shipment", () => {
    const fixes = applyPositionEvent(new Map(), position());
    expect(fixes.get("s-1")).toEqual({
      lat: 51.5,
      lng: 4.6,
      recordedAt: "2026-10-31T12:00:30.000Z",
    });
  });

  it("replaces a fix with a newer one without mutating the old map", () => {
    const before = applyPositionEvent(new Map(), position());
    const after = applyPositionEvent(
      before,
      position({ lat: 51.4, recordedAt: "2026-10-31T12:00:45.000Z" }),
    );
    expect(after.get("s-1")?.lat).toBe(51.4);
    expect(before.get("s-1")?.lat).toBe(51.5);
  });

  it("ignores a late event and returns the same map, so nothing re-renders", () => {
    const before = applyPositionEvent(new Map(), position());
    const late = position({ lat: 50, recordedAt: "2026-10-31T11:59:00.000Z" });
    expect(applyPositionEvent(before, late)).toBe(before);
  });
});

describe("mergeFleet", () => {
  it("moves a shipment to a newer live fix", () => {
    const fixes = applyPositionEvent(new Map(), position());
    expect(mergeFleet([shipment()], fixes)).toEqual([
      shipment({ lat: 51.5, lng: 4.6, recordedAt: "2026-10-31T12:00:30.000Z" }),
    ]);
  });

  it("keeps a refreshed snapshot that is newer than the live fix", () => {
    const fixes = applyPositionEvent(new Map(), position());
    const refreshed = shipment({ lat: 51.3, recordedAt: "2026-10-31T12:01:00.000Z" });
    expect(mergeFleet([refreshed], fixes)).toEqual([refreshed]);
  });

  it("lets the snapshot decide which shipments exist", () => {
    // s-2 finished: it is no longer in the snapshot, so its fix does not bring it back.
    const fixes: LiveFixes = new Map([
      ["s-2", { lat: 50, lng: 5, recordedAt: "2026-10-31T13:00:00.000Z" }],
    ]);
    expect(mergeFleet([shipment()], fixes)).toEqual([shipment()]);
    expect(mergeFleet([], fixes)).toEqual([]);
  });

  it("returns untouched shipments as they are", () => {
    const untouched = shipment();
    expect(mergeFleet([untouched], new Map())[0]).toBe(untouched);
  });
});

describe("isUnknownShipment", () => {
  it("flags a first ping for a shipment the snapshot lacks", () => {
    expect(isUnknownShipment([shipment()], position())).toBe(false);
    expect(isUnknownShipment([shipment()], position({ shipmentId: "s-9" }))).toBe(true);
  });
});

describe("sortFleetForList", () => {
  it("lists exceptions first, then by tracking code, without reordering the input", () => {
    const input = [
      shipment({ shipmentId: "b", trackingCode: "WB-BBBB-BBBB" }),
      shipment({ shipmentId: "c", trackingCode: "WB-CCCC-CCCC", status: "exception" }),
      shipment({ shipmentId: "a", trackingCode: "WB-AAAA-AAAA", status: "out_for_delivery" }),
    ];
    expect(sortFleetForList(input).map((s) => s.shipmentId)).toEqual(["c", "a", "b"]);
    expect(input.map((s) => s.shipmentId)).toEqual(["b", "c", "a"]);
  });
});
