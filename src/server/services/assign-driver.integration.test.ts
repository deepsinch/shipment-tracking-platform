import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipmentEvents, shipments, type Shipment } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
  createTestUser,
} from "../../../tests/integration/fixtures";
import { assignDriver } from "./assign-driver";
import { changeShipmentStatus } from "./change-shipment-status";

const eventsFor = (shipmentId: string) =>
  getDb()
    .select()
    .from(shipmentEvents)
    .where(eq(shipmentEvents.shipmentId, shipmentId))
    .orderBy(shipmentEvents.recordedAt);

const reload = async (shipmentId: string) => {
  const [row] = await getDb().select().from(shipments).where(eq(shipments.id, shipmentId));
  return row!;
};

/** Asserts the shipment's driver, version and history are exactly as they were. */
async function expectUnchanged(shipment: Shipment) {
  const current = await reload(shipment.id);
  expect({ driver: current.assignedDriverId, version: current.version }).toEqual({
    driver: shipment.assignedDriverId,
    version: shipment.version,
  });
  expect((await eventsFor(shipment.id)).map((event) => event.type)).toEqual(["created"]);
}

describe("assignDriver", () => {
  let orgId: string;
  let dispatcher: AuthContext;
  let driverA: AuthContext;
  let driverB: AuthContext;
  const newShipment = (overrides: Partial<Shipment> = {}) =>
    createTestShipment(orgId, dispatcher.userId, overrides);

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
    driverA = await createTestContext(orgId, "driver");
    driverB = await createTestContext(orgId, "driver");
  });

  it("assigns a driver, bumps the version and records exactly one internal event", async () => {
    const shipment = await newShipment();

    const result = await assignDriver(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: driverA.userId,
    });

    if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result)}`);
    expect(result.shipment).toMatchObject({ assignedDriverId: driverA.userId, version: 2 });
    expect(await reload(shipment.id)).toMatchObject({
      assignedDriverId: driverA.userId,
      version: 2,
      status: "created",
    });

    const events = await eventsFor(shipment.id);
    expect(events.map((event) => event.type)).toEqual(["created", "driver_assigned"]);
    expect(events[1]).toEqual(result.event);
    expect(result.event).toMatchObject({
      organizationId: orgId,
      type: "driver_assigned",
      fromStatus: null,
      toStatus: null,
      actorUserId: dispatcher.userId,
      publicNote: null,
      metadata: { fromDriverId: null, toDriverId: driverA.userId },
    });
  });

  it("reassigns to another driver, recording both drivers", async () => {
    const shipment = await newShipment({ assignedDriverId: driverA.userId });

    const result = await assignDriver(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: "1",
      driverId: driverB.userId,
    });

    expect(result.ok && result.event.metadata).toEqual({
      fromDriverId: driverA.userId,
      toDriverId: driverB.userId,
    });
  });

  it("unassigns with null or a blank form value", async () => {
    for (const driverId of [null, ""]) {
      const shipment = await newShipment({ assignedDriverId: driverA.userId });

      const result = await assignDriver(dispatcher, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        driverId,
      });

      if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result)}`);
      expect(await reload(shipment.id)).toMatchObject({ assignedDriverId: null, version: 2 });
      expect(result.event.metadata).toEqual({ fromDriverId: driverA.userId, toDriverId: null });
    }
  });

  it("takes the shipment out of the old driver's scope and into the new one's", async () => {
    const shipment = await newShipment({ assignedDriverId: driverA.userId });
    await assignDriver(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: driverB.userId,
    });

    const attempt = (driver: AuthContext) =>
      changeShipmentStatus(driver, {
        shipmentId: shipment.id,
        expectedVersion: 2,
        toStatus: "picked_up",
      });
    expect(await attempt(driverA)).toEqual({ ok: false, reason: "not_found" });
    expect(await attempt(driverB)).toMatchObject({ ok: true });
  });

  it("is available to admins", async () => {
    const admin = await createTestContext(orgId, "admin");
    const shipment = await newShipment();

    const result = await assignDriver(admin, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: driverA.userId,
    });

    expect(result.ok).toBe(true);
  });

  it("is forbidden for drivers, even on their own shipment", async () => {
    const shipment = await newShipment({ assignedDriverId: driverA.userId });

    const result = await assignDriver(driverA, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: driverB.userId,
    });

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    await expectUnchanged(shipment);
  });

  it.each([
    ["a dispatcher of the same organization", () => createTestUser(orgId, "dispatcher")],
    ["an admin of the same organization", () => createTestUser(orgId, "admin")],
    [
      "a driver of another organization",
      async () => createTestUser((await createTestOrganization()).id, "driver"),
    ],
    ["an unknown user id", async () => ({ id: randomUUID() })],
  ])("rejects %s as the driver, without writing anything", async (_label, makeUser) => {
    const shipment = await newShipment();
    const { id } = await makeUser();

    const result = await assignDriver(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: id,
    });

    expect(result).toEqual({
      ok: false,
      reason: "validation",
      fieldErrors: { driverId: ["Choose a driver from your organization"] },
    });
    await expectUnchanged(shipment);
  });

  it("reports a stale version as a conflict with the current shipment", async () => {
    const shipment = await newShipment();
    const first = await assignDriver(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: driverA.userId,
    });
    if (!first.ok) throw new Error("setup failed");

    const stale = await assignDriver(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: driverB.userId,
    });

    expect(stale).toEqual({ ok: false, reason: "conflict", current: first.shipment });
    expect(await reload(shipment.id)).toMatchObject({
      assignedDriverId: driverA.userId,
      version: 2,
    });
    expect(await eventsFor(shipment.id)).toHaveLength(2);
  });

  it("makes an open status form stale, since assignment bumps the version", async () => {
    const shipment = await newShipment();
    await assignDriver(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: driverA.userId,
    });

    const result = await changeShipmentStatus(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "picked_up",
    });

    expect(result).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("reports another organization's shipment as not found", async () => {
    const otherOrg = (await createTestOrganization()).id;
    const otherDispatcher = await createTestContext(otherOrg, "dispatcher");
    const foreign = await createTestShipment(otherOrg, otherDispatcher.userId);

    const result = await assignDriver(dispatcher, {
      shipmentId: foreign.id,
      expectedVersion: 1,
      driverId: driverA.userId,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    await expectUnchanged(foreign);
  });

  it("reports unknown and malformed ids as not found", async () => {
    for (const shipmentId of [randomUUID(), "not-a-uuid"]) {
      expect(
        await assignDriver(dispatcher, { shipmentId, expectedVersion: 1, driverId: null }),
      ).toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("keeps the driver of a delivered or cancelled shipment", async () => {
    for (const status of ["delivered", "cancelled"] as const) {
      const shipment = await newShipment({ status, assignedDriverId: driverA.userId });

      const result = await assignDriver(dispatcher, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        driverId: driverB.userId,
      });

      expect(result).toEqual({ ok: false, reason: "closed", status });
      await expectUnchanged(shipment);
    }
  });

  it("rejects assigning the driver who is already assigned", async () => {
    const shipment = await newShipment({ assignedDriverId: driverA.userId });

    const result = await assignDriver(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: driverA.userId,
    });

    expect(result).toEqual({
      ok: false,
      reason: "validation",
      fieldErrors: { driverId: ["This driver is already assigned"] },
    });
    await expectUnchanged(shipment);
  });

  it("requires the driver field, so a missing value never unassigns silently", async () => {
    const shipment = await newShipment({ assignedDriverId: driverA.userId });

    const result = await assignDriver(dispatcher, { shipmentId: shipment.id, expectedVersion: 1 });

    expect(result).toEqual({
      ok: false,
      reason: "validation",
      fieldErrors: { driverId: ["Choose a driver"] },
    });
    await expectUnchanged(shipment);
  });

  it("does not stop a driver from backdating a status change before the assignment", async () => {
    const shipment = await newShipment({ createdAt: new Date(Date.now() - 2 * 60 * 60_000) });
    await assignDriver(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: driverA.userId,
    });

    // Picked up 30 minutes ago, recorded after the office assigned the shipment just now.
    const result = await changeShipmentStatus(driverA, {
      shipmentId: shipment.id,
      expectedVersion: 2,
      toStatus: "picked_up",
      occurredAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    });

    expect(result).toMatchObject({ ok: true });
  });
});
