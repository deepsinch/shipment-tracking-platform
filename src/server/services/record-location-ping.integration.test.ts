import { setTimeout as sleep } from "node:timers/promises";

import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { MAX_CLOCK_SKEW_MS } from "@/domain/device-time";
import { PING_INTERVAL_MS } from "@/domain/location-sharing";
import type { ShipmentStatus } from "@/domain/shipment-status";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { locationPings, shipmentPositions, shipments, type Shipment } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { changeShipmentStatus } from "./change-shipment-status";
import { recordLocationPing, type RecordLocationPingResult } from "./record-location-ping";

const pingsFor = (shipmentId: string) =>
  getDb()
    .select()
    .from(locationPings)
    .where(eq(locationPings.shipmentId, shipmentId))
    .orderBy(locationPings.id);

const positionOf = async (shipmentId: string) => {
  const [row] = await getDb()
    .select()
    .from(shipmentPositions)
    .where(eq(shipmentPositions.shipmentId, shipmentId));
  return row;
};

const reload = async (shipmentId: string) => {
  const [row] = await getDb().select().from(shipments).where(eq(shipments.id, shipmentId));
  return row!;
};

/** Asserts nothing was written for the shipment: no ping, no position. */
async function expectNothingStored(shipmentId: string) {
  expect(await pingsFor(shipmentId)).toEqual([]);
  expect(await positionOf(shipmentId)).toBeUndefined();
}

const reasonOf = (result: RecordLocationPingResult) =>
  result.ok ? (result.accepted ? "accepted" : result.reason) : result.reason;

describe("recordLocationPing", () => {
  let orgId: string;
  let dispatcher: AuthContext;
  let driver: AuthContext;
  /** A fixed server clock per test run; tests step it forward explicitly. */
  const base = new Date(Math.floor(Date.now() / 1000) * 1000);
  const at = (offsetMs: number) => new Date(base.getTime() + offsetMs);
  const clock = (offsetMs: number) => ({ now: () => at(offsetMs) });

  const newShipment = (overrides: Partial<Shipment> = {}) =>
    createTestShipment(orgId, dispatcher.userId, {
      status: "in_transit",
      assignedDriverId: driver.userId,
      ...overrides,
    });

  /** A ping from `driver` for `shipmentId`, recorded and received at `offsetMs` from `base`. */
  const ping = (
    shipmentId: string,
    offsetMs = 0,
    fix: { lat?: number; lng?: number; recordedAt?: Date; ctx?: AuthContext } = {},
  ) =>
    recordLocationPing(
      fix.ctx ?? driver,
      {
        shipmentId,
        lat: fix.lat ?? 51.92,
        lng: fix.lng ?? 4.48,
        accuracyM: 8.5,
        recordedAt: (fix.recordedAt ?? at(offsetMs)).toISOString(),
      },
      clock(offsetMs),
    );

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
    driver = await createTestContext(orgId, "driver");
  });

  it("stores the ping and upserts the shipment's latest position in one go", async () => {
    const shipment = await newShipment();

    const result = await ping(shipment.id, 0, { lat: 51.9, lng: 4.4 });

    if (!result.ok || !result.accepted) throw new Error(`unexpected: ${JSON.stringify(result)}`);
    expect(result.positionMoved).toBe(true);
    expect(result.ping).toMatchObject({
      organizationId: orgId,
      shipmentId: shipment.id,
      driverId: driver.userId,
      lat: 51.9,
      lng: 4.4,
      accuracyM: 8.5,
      recordedAt: base,
      receivedAt: base,
    });
    expect(await pingsFor(shipment.id)).toEqual([result.ping]);
    expect(await positionOf(shipment.id)).toEqual({
      shipmentId: shipment.id,
      organizationId: orgId,
      lat: 51.9,
      lng: 4.4,
      accuracyM: 8.5,
      recordedAt: base,
      driverId: driver.userId,
      updatedAt: base,
    });

    // The next accepted ping moves the same row.
    const next = await ping(shipment.id, PING_INTERVAL_MS, { lat: 51.8, lng: 4.3 });
    expect(next).toMatchObject({ ok: true, accepted: true, positionMoved: true });
    expect(await pingsFor(shipment.id)).toHaveLength(2);
    expect(await positionOf(shipment.id)).toMatchObject({
      lat: 51.8,
      lng: 4.3,
      recordedAt: at(PING_INTERVAL_MS),
      updatedAt: at(PING_INTERVAL_MS),
    });
  });

  it("accepts pings in every on-the-road status", async () => {
    for (const status of ["picked_up", "in_transit", "out_for_delivery"] as const) {
      const shipment = await newShipment({ status });
      expect(reasonOf(await ping(shipment.id))).toBe("accepted");
    }
  });

  it("never touches the shipment's version, so open status forms stay valid", async () => {
    const shipment = await newShipment();

    await ping(shipment.id);
    await ping(shipment.id, PING_INTERVAL_MS);

    const after = await reload(shipment.id);
    expect({ version: after.version, updatedAt: after.updatedAt }).toEqual({
      version: shipment.version,
      updatedAt: shipment.updatedAt,
    });
    const statusChange = await changeShipmentStatus(driver, {
      shipmentId: shipment.id,
      expectedVersion: shipment.version,
      toStatus: "out_for_delivery",
    });
    expect(statusChange.ok).toBe(true);
  });

  describe("who and what", () => {
    it.each(["admin", "dispatcher"] as const)(
      "is forbidden for staff (%s), writing nothing",
      async (role) => {
        const shipment = await newShipment();
        const staff = await createTestContext(orgId, role);

        expect(await ping(shipment.id, 0, { ctx: staff })).toEqual({
          ok: false,
          reason: "forbidden",
        });
        await expectNothingStored(shipment.id);
      },
    );

    it("returns not_found for a shipment not assigned to the driver, writing nothing", async () => {
      const otherDriver = await createTestContext(orgId, "driver");
      const unassigned = await newShipment({ assignedDriverId: null });
      const someoneElses = await newShipment({ assignedDriverId: otherDriver.userId });

      for (const shipment of [unassigned, someoneElses]) {
        expect(await ping(shipment.id)).toEqual({ ok: false, reason: "not_found" });
        await expectNothingStored(shipment.id);
      }
    });

    it("returns not_found for another organization's shipment, writing nothing", async () => {
      const otherOrg = (await createTestOrganization()).id;
      const otherDispatcher = await createTestContext(otherOrg, "dispatcher");
      const outsider = await createTestContext(otherOrg, "driver");
      const shipment = await newShipment();
      // Even a driver of the other organization with this shipment's id gets nothing.
      const theirs = await createTestShipment(otherOrg, otherDispatcher.userId, {
        status: "in_transit",
        assignedDriverId: outsider.userId,
      });

      expect(await ping(shipment.id, 0, { ctx: outsider })).toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await ping(theirs.id)).toEqual({ ok: false, reason: "not_found" });
      await expectNothingStored(shipment.id);
      await expectNothingStored(theirs.id);
    });

    it("returns not_found for a malformed shipment id", async () => {
      expect(await ping("42")).toEqual({ ok: false, reason: "not_found" });
    });

    it.each<ShipmentStatus>(["created", "exception", "delivered", "cancelled"])(
      "rejects pings for a %s shipment, writing nothing",
      async (status) => {
        const shipment = await newShipment({ status });

        expect(await ping(shipment.id)).toEqual({ ok: false, reason: "inactive", status });
        await expectNothingStored(shipment.id);
      },
    );

    it("rejects a device time beyond the allowed clock skew, writing nothing", async () => {
      const shipment = await newShipment();

      const result = await ping(shipment.id, 0, { recordedAt: at(MAX_CLOCK_SKEW_MS + 1000) });

      expect(result).toEqual({
        ok: false,
        reason: "validation",
        fieldErrors: { recordedAt: ["The time cannot be in the future"] },
      });
      await expectNothingStored(shipment.id);
    });

    it("tolerates a device clock running slightly fast", async () => {
      const shipment = await newShipment();

      const result = await ping(shipment.id, 0, { recordedAt: at(MAX_CLOCK_SKEW_MS - 1000) });

      expect(reasonOf(result)).toBe("accepted");
    });

    it("returns field errors for invalid coordinates and missing values", async () => {
      const shipment = await newShipment();

      const result = await recordLocationPing(driver, {
        shipmentId: shipment.id,
        lat: 91,
        lng: null,
        accuracyM: -1,
        recordedAt: "yesterday",
      });

      if (result.ok || result.reason !== "validation") throw new Error("expected validation");
      expect(Object.keys(result.fieldErrors).sort()).toEqual([
        "accuracyM",
        "lat",
        "lng",
        "recordedAt",
      ]);
      await expectNothingStored(shipment.id);
    });
  });

  describe("throttling", () => {
    it("drops a ping inside the window without writing, and accepts once it has passed", async () => {
      const shipment = await newShipment();
      await ping(shipment.id, 0, { lat: 51.9 });

      const early = await ping(shipment.id, PING_INTERVAL_MS - 1, { lat: 50 });

      expect(early).toEqual({ ok: true, accepted: false, reason: "throttled" });
      expect(await pingsFor(shipment.id)).toHaveLength(1);
      expect(await positionOf(shipment.id)).toMatchObject({ lat: 51.9, updatedAt: base });

      // The window counts from the last accepted ping, not from the dropped one.
      const onTime = await ping(shipment.id, PING_INTERVAL_MS, { lat: 50 });
      expect(reasonOf(onTime)).toBe("accepted");
      expect(await positionOf(shipment.id)).toMatchObject({ lat: 50 });
    });

    it("throttles per shipment, not per driver", async () => {
      const first = await newShipment();
      const second = await newShipment();

      expect(reasonOf(await ping(first.id))).toBe("accepted");
      expect(reasonOf(await ping(second.id))).toBe("accepted");
    });

    it("accepts exactly one of a burst of parallel first pings", async () => {
      const shipment = await newShipment();

      const results = await Promise.all(
        Array.from({ length: 5 }, (_, index) => ping(shipment.id, 0, { lat: 50 + index })),
      );

      expect(results.map(reasonOf).sort()).toEqual([
        "accepted",
        "throttled",
        "throttled",
        "throttled",
        "throttled",
      ]);
      const pings = await pingsFor(shipment.id);
      expect(pings).toHaveLength(1);
      expect((await positionOf(shipment.id))!.lat).toBe(pings[0]!.lat);
    });

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

    it("accepts exactly one of two simultaneous pings once the window has passed", async () => {
      const shipment = await newShipment();
      await ping(shipment.id);

      // Make the race deterministic: a third transaction holds the position row, so both pings
      // read the shipment, find the last accepted ping outside the window and then queue on the
      // upsert. Once the lock is released one goes through; Postgres re-evaluates the other's
      // throttle condition against the committed row and it matches nothing. A read-then-write
      // check would accept both here.
      let pending: Promise<RecordLocationPingResult[]> | undefined;
      await getDb().transaction(async (tx) => {
        await tx.execute(
          sql`SELECT 1 FROM shipment_positions WHERE shipment_id = ${shipment.id} FOR UPDATE`,
        );
        pending = Promise.all([
          ping(shipment.id, PING_INTERVAL_MS, { lat: 50 }),
          ping(shipment.id, PING_INTERVAL_MS + 1, { lat: 49 }),
        ]);
        await waitForLockWaiters(2);
      });
      const results = await pending!;

      expect(results.map(reasonOf).sort()).toEqual(["accepted", "throttled"]);
      const pings = await pingsFor(shipment.id);
      expect(pings).toHaveLength(2);
      expect((await positionOf(shipment.id))!.lat).toBe(pings[1]!.lat);
    });
  });

  describe("late pings", () => {
    it("stores a ping older than the current position without moving the position", async () => {
      const shipment = await newShipment();
      await ping(shipment.id, 0, { lat: 51.9, lng: 4.4 });

      // Delivered after a reconnect: received later, but recorded before the stored position.
      const late = await ping(shipment.id, PING_INTERVAL_MS, {
        lat: 51.5,
        lng: 4.1,
        recordedAt: at(-60_000),
      });

      expect(late).toMatchObject({ ok: true, accepted: true, positionMoved: false });
      expect((await pingsFor(shipment.id)).map((row) => row.lat)).toEqual([51.9, 51.5]);
      expect(await positionOf(shipment.id)).toMatchObject({
        lat: 51.9,
        lng: 4.4,
        recordedAt: base,
        // It still counts as the last accepted ping for the throttle.
        updatedAt: at(PING_INTERVAL_MS),
      });
    });
  });
});
