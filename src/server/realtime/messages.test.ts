import { describe, expect, it } from "vitest";

import {
  decodeRealtimeMessage,
  encodeRealtimeMessage,
  MAX_PAYLOAD_BYTES,
  type RealtimeMessage,
} from "./messages";

const shipmentId = "6f1c1d5e-4a8b-4c3e-9f0a-1b2c3d4e5f60";

const changed: RealtimeMessage = {
  kind: "shipment_changed",
  organizationId: "org-1",
  shipmentId,
  assignedDriverId: "driver-2",
  previousDriverId: "driver-1",
  reason: "assignment",
};

const position: RealtimeMessage = {
  kind: "position",
  organizationId: "org-1",
  shipmentId,
  assignedDriverId: "driver-2",
  lat: 51.2194,
  lng: 4.4025,
  recordedAt: "2026-10-31T12:00:00.000Z",
};

describe("realtime message codec", () => {
  it.each([changed, position])("round-trips a $kind message", (message) => {
    expect(decodeRealtimeMessage(encodeRealtimeMessage(message))).toEqual(message);
  });

  it("stays far below Postgres's 8000-byte NOTIFY limit, even with maximal ids", () => {
    const longId = "x".repeat(100);
    const payload = encodeRealtimeMessage({
      ...changed,
      organizationId: longId,
      assignedDriverId: longId,
      previousDriverId: longId,
    });
    expect(Buffer.byteLength(payload)).toBeLessThan(MAX_PAYLOAD_BYTES / 10);
  });

  it("refuses to encode an invalid message", () => {
    expect(() => encodeRealtimeMessage({ ...position, lat: 91 })).toThrow();
    expect(() => encodeRealtimeMessage({ ...changed, shipmentId: "nope" })).toThrow();
    expect(() => encodeRealtimeMessage({ ...changed, organizationId: "" })).toThrow();
  });

  it("drops unknown fields when encoding", () => {
    const withExtra = { ...changed, recipientEmail: "secret@example.test" } as RealtimeMessage;
    expect(encodeRealtimeMessage(withExtra)).not.toContain("secret");
  });

  it.each([
    ["not JSON", "{"],
    ["JSON that is not an object", "42"],
    ["an unknown kind", JSON.stringify({ ...changed, kind: "deleted" })],
    ["a missing organization", JSON.stringify({ ...changed, organizationId: undefined })],
    ["an unknown reason", JSON.stringify({ ...changed, reason: "renamed" })],
    ["an invalid time", JSON.stringify({ ...position, recordedAt: "yesterday" })],
    ["out-of-range coordinates", JSON.stringify({ ...position, lng: 181 })],
  ])("decodes %s as null", (_, payload) => {
    expect(decodeRealtimeMessage(payload)).toBeNull();
  });
});
