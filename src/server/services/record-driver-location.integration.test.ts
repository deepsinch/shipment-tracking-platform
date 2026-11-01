import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PING_INTERVAL_MS } from "@/domain/location-sharing";
import { haversineMeters, measureRoute, pointAlong } from "@/lib/route-geometry";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { locationPings, shipmentPositions, type Shipment } from "@/server/db/schema";
import { roadRoutes, routeBetween } from "@/server/routes/road-routes";
import { roundDegrees, simulatedStepMeters } from "@/server/simulator/simulated-position";
import { DEFAULT_SIMULATOR_CONFIG } from "@/server/simulator/truck";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { recordDriverLocation } from "./record-driver-location";

/**
 * The driver app's entry point for positions. In demo mode a visitor's real position must never
 * reach the map, whatever the client sends; elsewhere the device's position is stored as before.
 */

const ROUTE = roadRoutes()[0]!;
const roadLine = measureRoute(routeBetween(ROUTE.from, ROUTE.to).line);
/** Where a truck without a position is after its first simulated step. */
const FIRST_STEP = pointAlong(
  roadLine,
  simulatedStepMeters("in_transit", DEFAULT_SIMULATOR_CONFIG),
);

/** A real visitor's fix, a long way from any route the demo drives. */
const DELHI = { lat: 28.6139, lng: 77.209 };

const pingsFor = (shipmentId: string) =>
  getDb().select().from(locationPings).where(eq(locationPings.shipmentId, shipmentId));
const positionOf = async (shipmentId: string) =>
  (
    await getDb()
      .select()
      .from(shipmentPositions)
      .where(eq(shipmentPositions.shipmentId, shipmentId))
  )[0];

describe("recordDriverLocation", () => {
  let orgId: string;
  let dispatcher: AuthContext;
  let driver: AuthContext;
  let otherDriver: AuthContext;
  const base = new Date(Math.floor(Date.now() / 1000) * 1000);
  const clock = (offsetMs = 0) => ({ now: () => new Date(base.getTime() + offsetMs) });

  const newShipment = (overrides: Partial<Shipment> = {}) =>
    createTestShipment(orgId, dispatcher.userId, {
      status: "in_transit",
      assignedDriverId: driver.userId,
      originLat: ROUTE.from.lat,
      originLng: ROUTE.from.lng,
      destinationLat: ROUTE.to.lat,
      destinationLng: ROUTE.to.lng,
      ...overrides,
    });

  /** What the driver app would send outside the demo: the device's fix. */
  const deviceFix = (shipmentId: string, offsetMs = 0) => ({
    shipmentId,
    ...DELHI,
    accuracyM: 4,
    // Device time an hour ago: a demo ping must not take this over either.
    recordedAt: new Date(base.getTime() + offsetMs - 3_600_000).toISOString(),
  });

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
    driver = await createTestContext(orgId, "driver");
    otherDriver = await createTestContext(orgId, "driver");
  });

  afterEach(() => vi.unstubAllEnvs());

  describe("in demo mode", () => {
    it("stores the simulated route position, not the coordinates the client supplied", async () => {
      const shipment = await newShipment();

      const result = await recordDriverLocation(driver, deviceFix(shipment.id), {
        demoMode: true,
        ...clock(),
      });

      if (!result.ok || !result.accepted) throw new Error(`unexpected: ${JSON.stringify(result)}`);
      const expected = { lat: roundDegrees(FIRST_STEP.lat), lng: roundDegrees(FIRST_STEP.lng) };
      expect(result.ping).toMatchObject({ ...expected, accuracyM: 10, recordedAt: base });
      expect(await positionOf(shipment.id)).toMatchObject({ ...expected, recordedAt: base });
      expect(await pingsFor(shipment.id)).toEqual([result.ping]);
      // Nowhere near the visitor.
      expect(haversineMeters(DELHI, result.ping)).toBeGreaterThan(1_000_000);
    });

    it("ignores every coordinate field, however malformed, and needs only the shipment id", async () => {
      const crafted = await newShipment();
      const idOnly = await newShipment();

      await recordDriverLocation(
        driver,
        { shipmentId: crafted.id, lat: "48.85", lng: null, accuracyM: -1, recordedAt: "nonsense" },
        { demoMode: true, ...clock() },
      );
      await recordDriverLocation(driver, { shipmentId: idOnly.id }, { demoMode: true, ...clock() });

      for (const shipment of [crafted, idOnly]) {
        expect(await positionOf(shipment.id)).toMatchObject({
          lat: roundDegrees(FIRST_STEP.lat),
          lng: roundDegrees(FIRST_STEP.lng),
        });
      }
    });

    it("carries on from the stored position, ping after ping, along the route", async () => {
      const shipment = await newShipment();
      const along = [];
      for (let i = 0; i < 3; i++) {
        const result = await recordDriverLocation(driver, deviceFix(shipment.id), {
          demoMode: true,
          ...clock(i * (PING_INTERVAL_MS + 1_000)),
        });
        expect(result).toMatchObject({ ok: true, accepted: true });
        along.push(await positionOf(shipment.id));
      }

      const fromStart = along.map((p) => haversineMeters(ROUTE.from, p!));
      expect(fromStart[0]).toBeLessThan(fromStart[1]!);
      expect(fromStart[1]).toBeLessThan(fromStart[2]!);
      // Each on the road route (within a metre of rounding), never at the supplied position.
      for (const position of along) {
        const nearest = Math.min(
          ...roadLine.coordinates.map(([lng, lat]) => haversineMeters({ lat, lng }, position!)),
        );
        expect(nearest).toBeLessThan(10_000);
        expect(haversineMeters(DELHI, position!)).toBeGreaterThan(1_000_000);
      }
    });

    it("keeps the normal path: throttled pings write nothing, the same rules apply", async () => {
      const shipment = await newShipment();
      const options = { demoMode: true, ...clock() };
      await recordDriverLocation(driver, { shipmentId: shipment.id }, options);

      const again = await recordDriverLocation(driver, { shipmentId: shipment.id }, options);

      expect(again).toEqual({ ok: true, accepted: false, reason: "throttled" });
      expect(await pingsFor(shipment.id)).toHaveLength(1);
    });

    it("keeps the scope: only drivers, only their own, only on the road", async () => {
      const mine = await newShipment();
      const theirs = await newShipment({ assignedDriverId: otherDriver.userId });
      const options = { demoMode: true, ...clock() };

      expect(await recordDriverLocation(dispatcher, { shipmentId: mine.id }, options)).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect(await recordDriverLocation(driver, { shipmentId: theirs.id }, options)).toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await recordDriverLocation(driver, { shipmentId: "nope" }, options)).toEqual({
        ok: false,
        reason: "not_found",
      });
      const mineDelivered = await newShipment({ status: "delivered" });
      expect(await recordDriverLocation(driver, { shipmentId: mineDelivered.id }, options)).toEqual(
        {
          ok: false,
          reason: "inactive",
          status: "delivered",
        },
      );
      for (const { id } of [mine, theirs, mineDelivered]) {
        expect(await positionOf(id)).toBeUndefined();
      }
    });

    it("says there is no route for a shipment booked without coordinates", async () => {
      const shipment = await newShipment({ originLat: null, originLng: null });

      const result = await recordDriverLocation(driver, deviceFix(shipment.id), {
        demoMode: true,
        ...clock(),
      });

      expect(result).toEqual({ ok: false, reason: "no_route" });
      expect(await pingsFor(shipment.id)).toEqual([]);
    });

    it("reads demo mode from the environment by default", async () => {
      vi.resetModules();
      vi.stubEnv("DEMO_MODE", "true");
      vi.stubEnv("CRON_SECRET", "a-long-enough-cron-secret");
      vi.stubEnv("DEMO_RESET_DATABASES", "waybill_test");
      const { recordDriverLocation: fromEnv } = await import("./record-driver-location");
      const shipment = await newShipment();

      const result = await fromEnv(driver, deviceFix(shipment.id), clock());

      expect(result).toMatchObject({ ok: true, accepted: true });
      expect(haversineMeters(DELHI, (await positionOf(shipment.id))!)).toBeGreaterThan(1_000_000);
    });
  });

  describe("outside demo mode", () => {
    it("stores the coordinates the device supplied, as before", async () => {
      const shipment = await newShipment();

      const result = await recordDriverLocation(driver, deviceFix(shipment.id), {
        demoMode: false,
        ...clock(),
      });

      if (!result.ok || !result.accepted) throw new Error(`unexpected: ${JSON.stringify(result)}`);
      expect(result.ping).toMatchObject({ ...DELHI, accuracyM: 4 });
      expect(await positionOf(shipment.id)).toMatchObject(DELHI);
    });

    it("needs the full fix: a bare shipment id is a validation failure and stores nothing", async () => {
      const shipment = await newShipment();

      const result = await recordDriverLocation(
        driver,
        { shipmentId: shipment.id },
        { demoMode: false, ...clock() },
      );

      expect(result).toMatchObject({ ok: false, reason: "validation" });
      expect(await positionOf(shipment.id)).toBeUndefined();
    });

    it("is off unless DEMO_MODE says otherwise", async () => {
      vi.resetModules();
      vi.stubEnv("DEMO_MODE", "false");
      const { recordDriverLocation: fromEnv } = await import("./record-driver-location");
      const shipment = await newShipment();

      await fromEnv(driver, deviceFix(shipment.id), clock());

      expect(await positionOf(shipment.id)).toMatchObject(DELHI);
    });
  });
});
