import { beforeAll, describe, expect, it } from "vitest";

import { generateTrackingCode } from "@/domain/tracking-code";
import type { Shipment } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { assignDriver } from "./assign-driver";
import { changeShipmentStatus } from "./change-shipment-status";
import { getPublicTracking, type PublicTracking } from "./public-tracking";
import { recordLocationPing } from "./record-location-ping";

describe("getPublicTracking", () => {
  let shipment: Shipment;
  let driverId: string;
  let secondDriverId: string;
  let orgId: string;

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    const dispatcher = await createTestContext(orgId, "dispatcher");
    const driver = await createTestContext(orgId, "driver");
    driverId = driver.userId;
    shipment = await createTestShipment(orgId, dispatcher.userId, {
      recipientEmail: "secret-recipient@example.test",
      originCity: "Rotterdam",
      destinationCity: "Antwerp",
      assignedDriverId: driver.userId,
      promisedDeliveryAt: new Date("2026-12-01T17:00:00Z"),
      createdAt: new Date(Date.now() - 3 * 60 * 60_000),
    });
    const result = await changeShipmentStatus(driver, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "picked_up",
      publicNote: "Your parcel is on its way",
      internalNote: "SECRET-INTERNAL-NOTE",
      location: { city: "Rotterdam", lat: 51.92, lng: 4.48 },
    });
    if (!result.ok) throw new Error("setup failed");

    // Internal history: a reassignment must never reach the public timeline.
    const secondDriver = await createTestContext(orgId, "driver");
    secondDriverId = secondDriver.userId;
    const reassigned = await assignDriver(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 2,
      driverId: secondDriver.userId,
    });
    if (!reassigned.ok) throw new Error("setup failed");
  });

  const track = async (code: string): Promise<PublicTracking> => {
    const tracking = await getPublicTracking(code);
    if (!tracking) throw new Error(`no tracking for ${code}`);
    return tracking;
  };

  // If this fails because a field was added, check it is safe for anyone holding the code to see
  // before updating the list. See docs/architecture.md, "Public tracking page".
  it("returns exactly the public fields, nothing more", async () => {
    const tracking = await track(shipment.trackingCode);

    expect(Object.keys(tracking).sort()).toEqual([
      "destination",
      "origin",
      "promisedDeliveryAt",
      "signedBy",
      "status",
      "timeline",
      "trackingCode",
    ]);
    expect(Object.keys(tracking.origin).sort()).toEqual(["city", "country"]);
    expect(Object.keys(tracking.destination).sort()).toEqual(["city", "country"]);
    for (const entry of tracking.timeline) {
      expect(Object.keys(entry).sort()).toEqual([
        "city",
        "occurredAt",
        "publicNote",
        "status",
        "type",
      ]);
    }
  });

  it("returns the status, route, promised delivery and timeline in order", async () => {
    expect(await track(shipment.trackingCode)).toEqual({
      trackingCode: shipment.trackingCode,
      status: "picked_up",
      origin: { city: "Rotterdam", country: "NL" },
      destination: { city: "Antwerp", country: "BE" },
      promisedDeliveryAt: new Date("2026-12-01T17:00:00Z"),
      signedBy: null,
      timeline: [
        {
          type: "created",
          status: "created",
          occurredAt: shipment.createdAt,
          city: null,
          publicNote: null,
        },
        {
          type: "status_changed",
          status: "picked_up",
          occurredAt: expect.any(Date),
          city: "Rotterdam",
          publicNote: "Your parcel is on its way",
        },
      ],
    });
  });

  it("never exposes internal notes, contact details, people or internal ids", async () => {
    const serialized = JSON.stringify(await track(shipment.trackingCode));

    for (const secret of [
      "SECRET-INTERNAL-NOTE",
      "secret-recipient@example.test",
      shipment.recipientName,
      shipment.originAddressLine,
      shipment.id,
      shipment.organizationId,
      shipment.createdBy,
      driverId,
      secondDriverId,
      "51.92",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("lists only customer-facing event types, never driver assignments", async () => {
    const { timeline } = await track(shipment.trackingCode);

    expect(timeline.map((entry) => entry.type)).toEqual(["created", "status_changed"]);
    expect(JSON.stringify(timeline)).not.toContain("driver_assigned");
  });

  it.each([
    ["lowercase", (code: string) => code.toLowerCase()],
    ["without dashes", (code: string) => code.replaceAll("-", "")],
    ["with spaces", (code: string) => ` ${code.replaceAll("-", " ")} `],
  ])("accepts the code %s", async (_label, format) => {
    const tracking = await track(format(shipment.trackingCode));
    expect(tracking.trackingCode).toBe(shipment.trackingCode);
  });

  it("returns null for an unknown or invalid code", async () => {
    expect(await getPublicTracking(generateTrackingCode())).toBeNull();
    expect(await getPublicTracking("not a code")).toBeNull();
    expect(await getPublicTracking("")).toBeNull();
  });

  // Exact coordinates are never public (docs/architecture.md, "Public projection rules").
  it("is unchanged by location pings, which never expose coordinates", async () => {
    const before = await track(shipment.trackingCode);

    const pinged = await recordLocationPing(
      { userId: secondDriverId, organizationId: orgId, role: "driver" },
      {
        shipmentId: shipment.id,
        lat: 51.234567,
        lng: 4.765432,
        accuracyM: 7,
        recordedAt: new Date(),
      },
    );
    expect(pinged).toMatchObject({ ok: true, accepted: true });

    const after = await track(shipment.trackingCode);
    expect(after).toEqual(before);
    const serialized = JSON.stringify(after);
    expect(serialized).not.toContain("51.234567");
    expect(serialized).not.toContain("4.765432");
  });
});
