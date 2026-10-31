import { describe, expect, it } from "vitest";

import { parseRealtimeClientEvent } from "./realtime-events";

describe("parseRealtimeClientEvent", () => {
  it("parses each event kind", () => {
    expect(parseRealtimeClientEvent('{"kind":"resync"}')).toEqual({ kind: "resync" });
    expect(
      parseRealtimeClientEvent('{"kind":"shipment_changed","shipmentId":"s1","reason":"status"}'),
    ).toEqual({ kind: "shipment_changed", shipmentId: "s1", reason: "status" });
    expect(
      parseRealtimeClientEvent(
        '{"kind":"position","shipmentId":"s1","lat":51.2,"lng":4.4,"recordedAt":"2026-10-31T12:00:00.000Z"}',
      ),
    ).toEqual({
      kind: "position",
      shipmentId: "s1",
      lat: 51.2,
      lng: 4.4,
      recordedAt: "2026-10-31T12:00:00.000Z",
    });
  });

  it("keeps only the known fields", () => {
    expect(parseRealtimeClientEvent('{"kind":"resync","extra":1}')).toEqual({ kind: "resync" });
  });

  it.each([
    ["not JSON", "{"],
    ["null", "null"],
    ["an unknown kind", '{"kind":"deleted","shipmentId":"s1"}'],
    ["a change without an id", '{"kind":"shipment_changed","reason":"status"}'],
    ["an unknown reason", '{"kind":"shipment_changed","shipmentId":"s1","reason":"x"}'],
    [
      "a position with a string latitude",
      '{"kind":"position","shipmentId":"s1","lat":"51","lng":4,"recordedAt":"2026-10-31T12:00:00Z"}',
    ],
    [
      "a position with an invalid time",
      '{"kind":"position","shipmentId":"s1","lat":51,"lng":4,"recordedAt":"soon"}',
    ],
  ])("ignores %s", (_, data) => {
    expect(parseRealtimeClientEvent(data)).toBeNull();
  });
});
