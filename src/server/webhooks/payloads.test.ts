import { describe, expect, it } from "vitest";

import type { Shipment } from "@/server/db/schema";

import {
  envelope,
  toDriverAssignedData,
  toShipmentCreatedData,
  toStatusChangedData,
} from "./payloads";

const shipment: Shipment = {
  id: "5b6c8a1e-0000-4000-8000-000000000001",
  organizationId: "org_internal",
  trackingCode: "WB-ABCDEFGH",
  status: "in_transit",
  reference: "PO-1",
  recipientName: "Ada Recipient",
  recipientEmail: "ada@example.com",
  originAddressLine: "1 Origin Street",
  originCity: "Rotterdam",
  originPostalCode: "3011",
  originCountry: "NL",
  originLat: 51.9,
  originLng: 4.4,
  destinationAddressLine: "2 Destination Road",
  destinationCity: "Antwerp",
  destinationPostalCode: "2000",
  destinationCountry: "BE",
  destinationLat: null,
  destinationLng: null,
  weightKg: 12.5,
  serviceLevel: "standard",
  promisedDeliveryAt: new Date("2026-03-05T10:00:00Z"),
  assignedDriverId: "user_internal_driver",
  createdBy: "user_internal_creator",
  version: 3,
  createdAt: new Date("2026-03-01T09:00:00Z"),
  updatedAt: new Date("2026-03-01T10:00:00Z"),
} as Shipment;

const keys = (value: object) => Object.keys(value).sort();

describe("webhook payloads", () => {
  it("wraps data in an envelope with the event id, type and time", () => {
    const wrapped = envelope("e1", "shipment.created", new Date("2026-03-01T09:00:00Z"), {});
    expect(keys(wrapped)).toEqual(["createdAt", "data", "id", "type"]);
    expect(wrapped.createdAt).toBe("2026-03-01T09:00:00.000Z");
  });

  it("shipment.created carries exactly the API shipment and its version", () => {
    const data = toShipmentCreatedData(shipment);
    expect(keys(data)).toEqual(["shipment", "version"]);
    expect(keys(data.shipment)).toEqual([
      "createdAt",
      "destination",
      "id",
      "origin",
      "promisedDeliveryAt",
      "recipient",
      "reference",
      "serviceLevel",
      "status",
      "trackingCode",
      "updatedAt",
      "weightKg",
    ]);
    expect(data.version).toBe(3);
  });

  it("shipment.status_changed adds the change, without internal notes or ids", () => {
    const data = toStatusChangedData(shipment, {
      fromStatus: "picked_up",
      toStatus: "in_transit",
      occurredAt: new Date("2026-03-01T10:00:00Z"),
      locationCity: "Breda",
      locationLat: null,
      locationLng: null,
      publicNote: "On the road",
    });
    expect(keys(data)).toEqual(["change", "shipment", "version"]);
    expect(keys(data.change)).toEqual([
      "fromStatus",
      "location",
      "occurredAt",
      "publicNote",
      "toStatus",
    ]);
    expect(keys(data.change.location!)).toEqual(["city", "lat", "lng"]);
  });

  it("shipment.status_changed has no location when the event has none", () => {
    const data = toStatusChangedData(shipment, {
      fromStatus: null,
      toStatus: "created",
      occurredAt: new Date(),
      locationCity: null,
      locationLat: null,
      locationLng: null,
      publicNote: null,
    });
    expect(data.change.location).toBeNull();
  });

  describe("proof of delivery", () => {
    const delivered = {
      fromStatus: "out_for_delivery" as const,
      toStatus: "delivered" as const,
      occurredAt: new Date("2026-03-02T10:00:00Z"),
      locationCity: null,
      locationLat: null,
      locationLng: null,
      publicNote: null,
    };

    it("a delivery carries only the name and whether a signature and a photo exist", () => {
      const data = toStatusChangedData(shipment, delivered, {
        recipientName: "Ada R.",
        hasSignature: true,
        hasPhoto: false,
      });
      expect(keys(data.change)).toEqual([
        "fromStatus",
        "location",
        "occurredAt",
        "proof",
        "publicNote",
        "toStatus",
      ]);
      expect(data.change.proof).toEqual({
        recipientName: "Ada R.",
        hasSignature: true,
        hasPhoto: false,
      });
      expect(keys(data.change.proof!)).toEqual(["hasPhoto", "hasSignature", "recipientName"]);
    });

    it("copies the three fields by name, so a richer proof object leaks nothing", () => {
      const rich = {
        recipientName: "Ada R.",
        hasSignature: true,
        hasPhoto: true,
        signature: { aspect: 2, strokes: [[[0.1, 0.1]]] },
        photoKey: "delivery-proofs/org/ship/x.jpg",
      };
      const data = toStatusChangedData(shipment, delivered, rich);
      expect(JSON.stringify(data)).not.toContain("strokes");
      expect(JSON.stringify(data)).not.toContain("delivery-proofs/");
      expect(keys(data.change.proof!)).toEqual(["hasPhoto", "hasSignature", "recipientName"]);
    });

    it("a delivery without proof says so with null", () => {
      expect(toStatusChangedData(shipment, delivered).change.proof).toBeNull();
    });

    it("other changes have no proof key at all", () => {
      const data = toStatusChangedData(shipment, { ...delivered, toStatus: "in_transit" });
      expect(keys(data.change)).not.toContain("proof");
    });
  });

  it("shipment.driver_assigned names drivers and never carries their ids", () => {
    const data = toDriverAssignedData(shipment, { fromName: null, toName: "Dries Driver" });
    expect(keys(data)).toEqual(["assignment", "shipment", "version"]);
    expect(keys(data.assignment)).toEqual(["fromDriverName", "toDriverName"]);
  });

  it("never leaks an internal id anywhere in any payload", () => {
    const all = JSON.stringify([
      toShipmentCreatedData(shipment),
      toStatusChangedData(shipment, {
        fromStatus: null,
        toStatus: "created",
        occurredAt: new Date(),
        locationCity: null,
        locationLat: null,
        locationLng: null,
        publicNote: null,
      }),
      toDriverAssignedData(shipment, { fromName: "A", toName: "B" }),
    ]);
    expect(all).not.toContain("org_internal");
    expect(all).not.toContain("user_internal");
  });
});
