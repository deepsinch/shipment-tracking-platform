import { setTimeout as sleep } from "node:timers/promises";

import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipmentEvents, shipments, type Shipment } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { changeShipmentStatus, type ChangeShipmentStatusResult } from "./change-shipment-status";

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

/** Asserts the shipment and its history are exactly as they were. */
async function expectUnchanged(shipment: Shipment) {
  const current = await reload(shipment.id);
  expect({ status: current.status, version: current.version }).toEqual({
    status: shipment.status,
    version: shipment.version,
  });
  expect((await eventsFor(shipment.id)).map((event) => event.type)).toEqual(["created"]);
}

describe("changeShipmentStatus", () => {
  let orgId: string;
  let dispatcher: AuthContext;
  const newShipment = (overrides: Partial<Shipment> = {}) =>
    createTestShipment(orgId, dispatcher.userId, overrides);

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
  });

  it("updates the status, bumps the version and records the event in one go", async () => {
    const shipment = await newShipment({ createdAt: new Date(Date.now() - 2 * 60 * 60_000) });
    const occurredAt = new Date(Date.now() - 30 * 60_000);

    const result = await changeShipmentStatus(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "picked_up",
      occurredAt: occurredAt.toISOString(),
      publicNote: "Collected from the warehouse",
      internalNote: "Dock 4, driver was late",
      location: { city: "Rotterdam", lat: "51.92", lng: "4.48" },
    });

    if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result)}`);
    expect(result.shipment).toMatchObject({ status: "picked_up", version: 2 });
    expect(await reload(shipment.id)).toMatchObject({ status: "picked_up", version: 2 });

    const events = await eventsFor(shipment.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual(result.event);
    expect(result.event).toMatchObject({
      organizationId: orgId,
      type: "status_changed",
      fromStatus: "created",
      toStatus: "picked_up",
      occurredAt,
      actorUserId: dispatcher.userId,
      locationCity: "Rotterdam",
      locationLat: 51.92,
      locationLng: 4.48,
      publicNote: "Collected from the warehouse",
      internalNote: "Dock 4, driver was late",
    });
  });

  it("lets an admin change any shipment in the organization", async () => {
    const admin = await createTestContext(orgId, "admin");
    const shipment = await newShipment();

    const result = await changeShipmentStatus(admin, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "cancelled",
    });

    expect(result.ok && result.shipment.status).toBe("cancelled");
  });

  it("rejects a transition the state machine does not allow, writing nothing", async () => {
    const shipment = await newShipment();

    const result = await changeShipmentStatus(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "delivered",
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid_transition",
      from: "created",
      to: "delivered",
    });
    await expectUnchanged(shipment);
  });

  it("reports a conflict for a stale version, writing nothing, with the current data", async () => {
    const shipment = await newShipment({ status: "picked_up", version: 3 });

    const result = await changeShipmentStatus(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 2,
      toStatus: "in_transit",
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "conflict",
      current: { id: shipment.id, status: "picked_up", version: 3 },
    });
    await expectUnchanged(shipment);
  });

  it("returns not_found for another organization's shipment, writing nothing", async () => {
    const shipment = await newShipment();
    const outsider = await createTestContext((await createTestOrganization()).id, "admin");

    const result = await changeShipmentStatus(outsider, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "picked_up",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
    await expectUnchanged(shipment);
  });

  it("returns not_found for a malformed shipment id", async () => {
    const result = await changeShipmentStatus(dispatcher, {
      shipmentId: "42",
      expectedVersion: 1,
      toStatus: "picked_up",
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns field errors for invalid input, writing nothing", async () => {
    const shipment = await newShipment();

    const result = await changeShipmentStatus(dispatcher, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "picked_up",
      occurredAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      location: { lat: "123" },
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "validation") throw new Error("expected validation failure");
    expect(Object.keys(result.fieldErrors).sort()).toEqual(["location.lat", "occurredAt"]);
    await expectUnchanged(shipment);
  });

  describe("event time", () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60_000);

    it("rejects a time before the latest event, writing nothing", async () => {
      const shipment = await newShipment({ createdAt: hoursAgo(1) });

      const result = await changeShipmentStatus(dispatcher, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "picked_up",
        occurredAt: hoursAgo(2),
      });

      expect(result).toEqual({
        ok: false,
        reason: "validation",
        fieldErrors: {
          occurredAt: [`Must be after the previous update (${shipment.createdAt.toISOString()})`],
        },
      });
      await expectUnchanged(shipment);
    });

    it("accepts a time equal to the latest event", async () => {
      const shipment = await newShipment({ createdAt: hoursAgo(1) });

      const result = await changeShipmentStatus(dispatcher, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "picked_up",
        occurredAt: shipment.createdAt,
      });

      expect(result.ok && result.event.occurredAt).toEqual(shipment.createdAt);
    });

    it("compares against the latest event, not the first", async () => {
      const shipment = await newShipment({ createdAt: hoursAgo(3) });
      const first = await changeShipmentStatus(dispatcher, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "picked_up",
        occurredAt: hoursAgo(1),
      });
      expect(first.ok).toBe(true);

      const tooEarly = await changeShipmentStatus(dispatcher, {
        shipmentId: shipment.id,
        expectedVersion: 2,
        toStatus: "in_transit",
        occurredAt: hoursAgo(2),
      });
      const later = await changeShipmentStatus(dispatcher, {
        shipmentId: shipment.id,
        expectedVersion: 2,
        toStatus: "in_transit",
        occurredAt: hoursAgo(0.5),
      });

      expect(tooEarly).toMatchObject({ ok: false, reason: "validation" });
      expect(later.ok).toBe(true);
    });

    it("never defaults to a time before the latest event (fast device clock)", async () => {
      const slightlyAhead = new Date(Date.now() + 2 * 60_000);
      const shipment = await newShipment({ createdAt: slightlyAhead });

      const result = await changeShipmentStatus(dispatcher, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "picked_up",
      });

      expect(result.ok && result.event.occurredAt).toEqual(slightlyAhead);
    });
  });

  describe("drivers", () => {
    let driver: AuthContext;

    beforeAll(async () => {
      driver = await createTestContext(orgId, "driver");
    });

    it("cannot change a shipment that is not assigned to them (not_found)", async () => {
      const otherDriver = await createTestContext(orgId, "driver");
      const unassigned = await newShipment();
      const assignedToSomeoneElse = await newShipment({ assignedDriverId: otherDriver.userId });

      for (const shipment of [unassigned, assignedToSomeoneElse]) {
        const result = await changeShipmentStatus(driver, {
          shipmentId: shipment.id,
          expectedVersion: 1,
          toStatus: "picked_up",
        });
        expect(result).toEqual({ ok: false, reason: "not_found" });
        await expectUnchanged(shipment);
      }
    });

    it("can change a shipment assigned to them", async () => {
      const shipment = await newShipment({ assignedDriverId: driver.userId });

      const result = await changeShipmentStatus(driver, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "picked_up",
      });

      expect(result.ok && result.shipment.status).toBe("picked_up");
      expect(result.ok && result.event.actorUserId).toBe(driver.userId);
    });

    it("cannot cancel a shipment assigned to them (forbidden), writing nothing", async () => {
      const shipment = await newShipment({ assignedDriverId: driver.userId });

      const result = await changeShipmentStatus(driver, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "cancelled",
      });

      expect(result).toEqual({ ok: false, reason: "forbidden" });
      await expectUnchanged(shipment);
    });
  });

  describe("concurrency", () => {
    /** Waits until `count` backends in this database are blocked on a lock. */
    async function waitForLockWaiters(count: number) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const { rows } = await getDb().$client.query<{ waiting: number }>(
          `SELECT count(*)::int AS waiting FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        );
        if (rows[0]!.waiting >= count) return;
        await sleep(25);
      }
      throw new Error(`Timed out waiting for ${count} blocked transactions`);
    }

    it("lets exactly one of two simultaneous changes win; the other gets a conflict", async () => {
      const shipment = await newShipment();
      const otherDispatcher = await createTestContext(orgId, "dispatcher");
      const change = (ctx: AuthContext, toStatus: "picked_up" | "cancelled") =>
        changeShipmentStatus(ctx, { shipmentId: shipment.id, expectedVersion: 1, toStatus });

      // Make the race deterministic: a third transaction holds the row lock, so both changes read
      // version 1, pass the version pre-check and the state machine, and then queue on the guarded
      // UPDATE. Releasing the lock lets one through; Postgres re-checks the other's
      // `version = 1` against the committed row and matches nothing.
      let pending: Promise<ChangeShipmentStatusResult[]> | undefined;
      await getDb().transaction(async (tx) => {
        await tx.execute(sql`SELECT 1 FROM shipments WHERE id = ${shipment.id} FOR UPDATE`);
        pending = Promise.all([
          change(dispatcher, "picked_up"),
          change(otherDispatcher, "cancelled"),
        ]);
        await waitForLockWaiters(2);
      });
      const results = await pending!;

      const reasons = results.map((result) => (result.ok ? "ok" : result.reason)).sort();
      expect(reasons).toEqual(["conflict", "ok"]);

      const winner = results.find(
        (result): result is Extract<ChangeShipmentStatusResult, { ok: true }> => result.ok,
      )!;
      const current = await reload(shipment.id);
      expect(current).toMatchObject({ status: winner.shipment.status, version: 2 });
      expect(results.find((result) => !result.ok)).toMatchObject({
        reason: "conflict",
        current: { status: winner.shipment.status, version: 2 },
      });
      const statusEvents = (await eventsFor(shipment.id)).filter(
        (event) => event.type === "status_changed",
      );
      expect(statusEvents).toHaveLength(1);
      expect(statusEvents[0]!.toStatus).toBe(winner.shipment.status);
    });
  });
});
