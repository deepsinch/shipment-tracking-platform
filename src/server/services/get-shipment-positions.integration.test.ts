import { beforeAll, describe, expect, it } from "vitest";

import { PING_INTERVAL_MS } from "@/domain/location-sharing";
import type { AuthContext } from "@/server/auth/auth-context";
import type { Shipment } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { changeShipmentStatus } from "./change-shipment-status";
import {
  getShipmentPositions,
  type GetShipmentPositionsResult,
  type ShipmentPositionSnapshot,
} from "./get-shipment-positions";
import { recordLocationPing } from "./record-location-ping";

const positionsOf = (result: GetShipmentPositionsResult): ShipmentPositionSnapshot[] => {
  if (!result.ok) throw new Error(`unexpected: ${JSON.stringify(result)}`);
  return result.positions;
};

const idsOf = (result: GetShipmentPositionsResult) =>
  positionsOf(result)
    .map((position) => position.shipmentId)
    .sort();

describe("getShipmentPositions", () => {
  let orgId: string;
  let dispatcher: AuthContext;
  let driver: AuthContext;
  let otherDriver: AuthContext;
  let mine: Shipment;
  let theirs: Shipment;
  let notPinged: Shipment;
  let outsiderShipment: Shipment;
  let outsider: AuthContext;
  const recordedAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);

  const pingAs = async (ctx: AuthContext, shipment: Shipment, lat: number, at = recordedAt) => {
    const result = await recordLocationPing(ctx, {
      shipmentId: shipment.id,
      lat,
      lng: 4.4,
      accuracyM: 10,
      recordedAt: at,
    });
    if (!result.ok || !result.accepted) throw new Error(`setup: ${JSON.stringify(result)}`);
  };

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
    driver = await createTestContext(orgId, "driver");
    otherDriver = await createTestContext(orgId, "driver");
    const onTheRoad = (assignedDriverId: string) =>
      createTestShipment(orgId, dispatcher.userId, { status: "in_transit", assignedDriverId });

    mine = await onTheRoad(driver.userId);
    theirs = await onTheRoad(otherDriver.userId);
    notPinged = await onTheRoad(driver.userId);
    await pingAs(driver, mine, 51.1);
    await pingAs(otherDriver, theirs, 51.2, new Date(recordedAt.getTime() + 1000));

    const otherOrg = (await createTestOrganization()).id;
    outsider = await createTestContext(otherOrg, "dispatcher");
    const outsiderDriver = await createTestContext(otherOrg, "driver");
    outsiderShipment = await createTestShipment(otherOrg, outsider.userId, {
      status: "in_transit",
      assignedDriverId: outsiderDriver.userId,
    });
    await pingAs(outsiderDriver, outsiderShipment, 48.8);
  });

  it("returns each pinged shipment's latest position, newest fix first", async () => {
    const positions = positionsOf(await getShipmentPositions(dispatcher));

    expect(positions).toEqual([
      {
        shipmentId: theirs.id,
        trackingCode: theirs.trackingCode,
        status: "in_transit",
        lat: 51.2,
        lng: 4.4,
        accuracyM: 10,
        recordedAt: new Date(recordedAt.getTime() + 1000),
        driverId: otherDriver.userId,
      },
      {
        shipmentId: mine.id,
        trackingCode: mine.trackingCode,
        status: "in_transit",
        lat: 51.1,
        lng: 4.4,
        accuracyM: 10,
        recordedAt,
        driverId: driver.userId,
      },
    ]);
    expect(positions.map((position) => position.shipmentId)).not.toContain(notPinged.id);
  });

  it("is scoped to the caller's organization", async () => {
    expect(idsOf(await getShipmentPositions(dispatcher))).not.toContain(outsiderShipment.id);
    expect(idsOf(await getShipmentPositions(outsider))).toEqual([outsiderShipment.id]);
    // Asking for another organization's shipment by id finds nothing.
    expect(
      idsOf(await getShipmentPositions(outsider, { shipmentIds: [mine.id, theirs.id] })),
    ).toEqual([]);
  });

  it("shows a driver only their own assignments", async () => {
    expect(idsOf(await getShipmentPositions(driver))).toEqual([mine.id]);
    expect(idsOf(await getShipmentPositions(driver, { shipmentIds: [theirs.id] }))).toEqual([]);
  });

  it("filters by shipment ids", async () => {
    expect(idsOf(await getShipmentPositions(dispatcher, { shipmentIds: [mine.id] }))).toEqual([
      mine.id,
    ]);
    expect(positionsOf(await getShipmentPositions(dispatcher, { shipmentIds: [] }))).toEqual([]);
  });

  it("rejects malformed ids", async () => {
    const result = await getShipmentPositions(dispatcher, { shipmentIds: ["42"] });
    expect(result).toMatchObject({ ok: false, reason: "validation" });
  });

  it("keeps exceptions on the map and drops finished shipments", async () => {
    const shipment = await createTestShipment(orgId, dispatcher.userId, {
      status: "out_for_delivery",
      assignedDriverId: driver.userId,
    });
    await pingAs(driver, shipment, 51.3);
    const scoped = () => getShipmentPositions(dispatcher, { shipmentIds: [shipment.id] });
    const change = async (expectedVersion: number, toStatus: "exception" | "out_for_delivery") => {
      const result = await changeShipmentStatus(driver, {
        shipmentId: shipment.id,
        expectedVersion,
        toStatus,
      });
      if (!result.ok) throw new Error(`setup: ${JSON.stringify(result)}`);
    };

    await change(1, "exception");
    expect(positionsOf(await scoped())).toMatchObject([{ status: "exception", lat: 51.3 }]);

    await change(2, "out_for_delivery");
    const delivered = await changeShipmentStatus(driver, {
      shipmentId: shipment.id,
      expectedVersion: 3,
      toStatus: "delivered",
    });
    expect(delivered.ok).toBe(true);
    expect(positionsOf(await scoped())).toEqual([]);
  });

  it("reflects the latest accepted ping", async () => {
    const shipment = await createTestShipment(orgId, dispatcher.userId, {
      status: "picked_up",
      assignedDriverId: driver.userId,
    });
    await pingAs(driver, shipment, 50);
    await recordLocationPing(
      driver,
      { shipmentId: shipment.id, lat: 50.5, lng: 4.4, accuracyM: 5, recordedAt: new Date() },
      { now: () => new Date(Date.now() + PING_INTERVAL_MS) },
    );

    expect(
      positionsOf(await getShipmentPositions(driver, { shipmentIds: [shipment.id] })),
    ).toMatchObject([{ lat: 50.5, accuracyM: 5 }]);
  });
});
