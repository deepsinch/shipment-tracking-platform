import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createTestOrganization,
  createTestShipment,
  createTestUser,
  pgErrorCode,
} from "../../../tests/integration/fixtures";
import { getDb } from "./client";
import { locationPings, shipmentPositions, type Shipment, type ShipmentPosition } from "./schema";

const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const RESTRICT_VIOLATION = "23001";

type NewPing = typeof locationPings.$inferInsert;

async function failureCode(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (error) {
    return pgErrorCode(error);
  }
  throw new Error("Expected the statement to be rejected, but it succeeded");
}

// Database guarantees behind recordLocationPing; they back up its validation, not replace it.
describe("location telemetry tables", () => {
  let orgId: string;
  let driverId: string;
  let shipment: Shipment;

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    const dispatcher = await createTestUser(orgId, "dispatcher");
    driverId = (await createTestUser(orgId, "driver")).id;
    shipment = await createTestShipment(orgId, dispatcher.id, {
      status: "in_transit",
      assignedDriverId: driverId,
    });
  });

  const ping = (overrides: Partial<NewPing> = {}): NewPing => ({
    organizationId: orgId,
    shipmentId: shipment.id,
    driverId,
    lat: 51.92,
    lng: 4.48,
    accuracyM: 12,
    recordedAt: new Date(),
    ...overrides,
  });

  const position = (overrides: Partial<ShipmentPosition> = {}): ShipmentPosition => ({
    shipmentId: shipment.id,
    organizationId: orgId,
    lat: 51.92,
    lng: 4.48,
    accuracyM: 12,
    recordedAt: new Date(),
    driverId,
    updatedAt: new Date(),
    ...overrides,
  });

  describe("location_pings", () => {
    it("stores a ping with the server's receive time", async () => {
      const [row] = await getDb().insert(locationPings).values(ping()).returning();
      expect(row).toMatchObject({ shipmentId: shipment.id, driverId, lat: 51.92, lng: 4.48 });
      expect(row!.receivedAt).toBeInstanceOf(Date);
    });

    it("rejects a ping whose organization differs from its shipment's", async () => {
      const otherOrg = await createTestOrganization("Other Org");
      const code = await failureCode(() =>
        getDb()
          .insert(locationPings)
          .values(ping({ organizationId: otherOrg.id })),
      );
      expect(code).toBe(FOREIGN_KEY_VIOLATION);
    });

    it.each([
      ["latitude out of range", { lat: 90.0001 }],
      ["longitude out of range", { lng: -180.5 }],
      ["negative accuracy", { accuracyM: -1 }],
    ])("rejects %s", async (_label, overrides) => {
      const code = await failureCode(() => getDb().insert(locationPings).values(ping(overrides)));
      expect(code).toBe(CHECK_VIOLATION);
    });

    it("rejects UPDATE: a recorded fix is never corrected", async () => {
      const [row] = await getDb().insert(locationPings).values(ping()).returning();

      const code = await failureCode(() =>
        getDb().update(locationPings).set({ lat: 0 }).where(eq(locationPings.id, row!.id)),
      );

      expect(code).toBe(RESTRICT_VIOLATION);
      const [after] = await getDb()
        .select()
        .from(locationPings)
        .where(eq(locationPings.id, row!.id));
      expect(after!.lat).toBe(51.92);
    });

    it("allows DELETE, so old pings can be pruned (30-day retention)", async () => {
      const [row] = await getDb().insert(locationPings).values(ping()).returning();

      await getDb().delete(locationPings).where(eq(locationPings.id, row!.id));

      expect(
        await getDb().select().from(locationPings).where(eq(locationPings.id, row!.id)),
      ).toEqual([]);
    });
  });

  describe("shipment_positions", () => {
    it("rejects a position whose organization differs from its shipment's", async () => {
      const otherOrg = await createTestOrganization("Other Org");
      const code = await failureCode(() =>
        getDb()
          .insert(shipmentPositions)
          .values(position({ organizationId: otherOrg.id })),
      );
      expect(code).toBe(FOREIGN_KEY_VIOLATION);
    });

    it.each([
      ["latitude out of range", { lat: -91 }],
      ["longitude out of range", { lng: 181 }],
      ["negative accuracy", { accuracyM: -0.5 }],
    ])("rejects %s", async (_label, overrides) => {
      const code = await failureCode(() =>
        getDb().insert(shipmentPositions).values(position(overrides)),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });
  });
});
