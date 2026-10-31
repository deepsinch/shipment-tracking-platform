import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PING_INTERVAL_MS } from "@/domain/location-sharing";
import type { AuthContext } from "@/server/auth/auth-context";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { recordRealtime } from "../../../tests/integration/realtime";
import { assignDriver } from "./assign-driver";
import { changeShipmentStatus } from "./change-shipment-status";
import { createShipment } from "./create-shipment";
import { recordLocationPing } from "./record-location-ping";

/** Which services announce what on the realtime bus, and that failed writes stay silent. */
describe("realtime announcements from services", () => {
  let orgId: string;
  let dispatcher: AuthContext;
  let driverA: AuthContext;
  let driverB: AuthContext;
  let realtime: Awaited<ReturnType<typeof recordRealtime>>;

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
    driverA = await createTestContext(orgId, "driver");
    driverB = await createTestContext(orgId, "driver");
    realtime = await recordRealtime();
  });

  afterAll(() => realtime.unsubscribe());

  const shipmentInput = {
    recipientName: "Ada Recipient",
    originAddressLine: "1 Origin Street",
    originCity: "Rotterdam",
    originCountry: "NL",
    destinationAddressLine: "2 Destination Road",
    destinationCity: "Antwerp",
    destinationCountry: "BE",
    weightKg: 10,
  };

  it("announces a new shipment with its driver", async () => {
    const result = await createShipment(dispatcher, {
      ...shipmentInput,
      assignedDriverId: driverA.userId,
    });
    if (!result.ok) throw new Error(JSON.stringify(result));

    await realtime.flush();
    expect(realtime.about(result.shipment.id)).toEqual([
      {
        kind: "shipment_changed",
        organizationId: orgId,
        shipmentId: result.shipment.id,
        assignedDriverId: driverA.userId,
        previousDriverId: null,
        reason: "created",
      },
    ]);
  });

  it("announces a status change, and nothing for a rejected one", async () => {
    const shipment = await createTestShipment(orgId, dispatcher.userId, {
      assignedDriverId: driverA.userId,
    });

    const changed = await changeShipmentStatus(driverA, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "picked_up",
    });
    expect(changed.ok).toBe(true);
    // A stale form (conflict) and an impossible move write nothing, so announce nothing.
    await changeShipmentStatus(driverA, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "in_transit",
    });
    await changeShipmentStatus(driverA, {
      shipmentId: shipment.id,
      expectedVersion: 2,
      toStatus: "delivered",
    });

    await realtime.flush();
    expect(realtime.about(shipment.id)).toEqual([
      expect.objectContaining({
        kind: "shipment_changed",
        reason: "status",
        assignedDriverId: driverA.userId,
        previousDriverId: null,
      }),
    ]);
  });

  it("announces a reassignment with the previous driver, and an unassignment", async () => {
    const shipment = await createTestShipment(orgId, dispatcher.userId, {
      assignedDriverId: driverA.userId,
    });

    await assignDriver(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: driverB.userId,
    });
    await assignDriver(dispatcher, { shipmentId: shipment.id, expectedVersion: 2, driverId: "" });

    await realtime.flush();
    expect(realtime.about(shipment.id)).toEqual([
      expect.objectContaining({
        reason: "assignment",
        assignedDriverId: driverB.userId,
        previousDriverId: driverA.userId,
      }),
      expect.objectContaining({
        reason: "assignment",
        assignedDriverId: null,
        previousDriverId: driverB.userId,
      }),
    ]);
  });

  it("announces a ping only when it moves the position", async () => {
    const shipment = await createTestShipment(orgId, dispatcher.userId, {
      status: "in_transit",
      assignedDriverId: driverA.userId,
    });
    const t0 = new Date(Math.floor(Date.now() / 1000) * 1000);
    const at = (ms: number) => new Date(t0.getTime() + ms);
    const ping = (receivedMs: number, recordedMs: number, lat: number) =>
      recordLocationPing(
        driverA,
        { shipmentId: shipment.id, lat, lng: 4.4, accuracyM: 5, recordedAt: at(recordedMs) },
        { now: () => at(receivedMs) },
      );

    expect(await ping(0, 0, 51.1)).toMatchObject({ accepted: true, positionMoved: true });
    // Throttled: inside the window, nothing stored.
    expect(await ping(1_000, 1_000, 51.2)).toMatchObject({ accepted: false });
    // Late: stored, but older than the current position.
    expect(await ping(PING_INTERVAL_MS, -5_000, 51.3)).toMatchObject({ positionMoved: false });

    await realtime.flush();
    expect(realtime.about(shipment.id)).toEqual([
      {
        kind: "position",
        organizationId: orgId,
        shipmentId: shipment.id,
        assignedDriverId: driverA.userId,
        lat: 51.1,
        lng: 4.4,
        recordedAt: at(0).toISOString(),
      },
    ]);
  });
});
