import { randomUUID } from "node:crypto";

import { count, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/server/db/client";
import {
  authRateLimits,
  locationPings,
  shipmentEvents,
  shipmentPositions,
} from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { purgeExpiredData } from "./purge-expired-data";

const DAY = 24 * 60 * 60_000;
const MINUTE = 60_000;

describe("purgeExpiredData", () => {
  let organizationId: string;
  let driverId: string;
  let shipmentId: string;

  beforeAll(async () => {
    organizationId = (await createTestOrganization()).id;
    const dispatcher = await createTestContext(organizationId, "dispatcher");
    driverId = (await createTestContext(organizationId, "driver")).userId;
    shipmentId = (await createTestShipment(organizationId, dispatcher.userId)).id;
  });

  async function addPing(receivedAt: Date) {
    const [row] = await getDb()
      .insert(locationPings)
      .values({
        organizationId,
        shipmentId,
        driverId,
        lat: 51.9,
        lng: 4.4,
        accuracyM: 10,
        recordedAt: receivedAt,
        receivedAt,
      })
      .returning({ id: locationPings.id });
    return row!.id;
  }

  async function addLimit(windowStart: Date) {
    const key = randomUUID();
    await getDb().insert(authRateLimits).values({ key, windowStart, count: 1 });
    return key;
  }

  it("deletes pings older than 30 days and rate-limit windows older than a day, keeping the rest", async () => {
    const now = new Date();
    const oldPing = await addPing(new Date(now.getTime() - 30 * DAY - MINUTE));
    const freshPing = await addPing(new Date(now.getTime() - 30 * DAY + MINUTE));
    const oldLimit = await addLimit(new Date(now.getTime() - DAY - MINUTE));
    const freshLimit = await addLimit(new Date(now.getTime() - DAY + MINUTE));

    const result = await purgeExpiredData(now);

    expect(result.locationPings).toBeGreaterThanOrEqual(1);
    expect(result.authRateLimits).toBeGreaterThanOrEqual(1);
    const db = getDb();
    const pingIds = (
      await db
        .select({ id: locationPings.id })
        .from(locationPings)
        .where(inArray(locationPings.id, [oldPing, freshPing]))
    ).map((row) => row.id);
    expect(pingIds).toEqual([freshPing]);
    const limitKeys = (
      await db
        .select({ key: authRateLimits.key })
        .from(authRateLimits)
        .where(inArray(authRateLimits.key, [oldLimit, freshLimit]))
    ).map((row) => row.key);
    expect(limitKeys).toEqual([freshLimit]);
  });

  it("never touches shipment history or current positions", async () => {
    const db = getDb();
    await db
      .insert(shipmentPositions)
      .values({
        shipmentId,
        organizationId,
        lat: 51.9,
        lng: 4.4,
        accuracyM: 10,
        driverId,
        recordedAt: new Date(0),
        updatedAt: new Date(0),
      })
      .onConflictDoNothing();
    const tally = async () => ({
      events: (
        await db
          .select({ n: count() })
          .from(shipmentEvents)
          .where(eq(shipmentEvents.shipmentId, shipmentId))
      )[0]!.n,
      positions: (
        await db
          .select({ n: count() })
          .from(shipmentPositions)
          .where(eq(shipmentPositions.shipmentId, shipmentId))
      )[0]!.n,
    });
    const before = await tally();
    expect(before.events).toBeGreaterThan(0);

    // The shipment has expired pings and the position is ancient: only the pings may go.
    await addPing(new Date(Date.now() - 90 * DAY));
    await purgeExpiredData();

    expect(await tally()).toEqual(before);
  });
});
