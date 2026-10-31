import { beforeAll, describe, expect, it } from "vitest";

import {
  createTestOrganization,
  createTestShipment,
  createTestUser,
  pgErrorCode,
} from "../../../tests/integration/fixtures";
import { db } from "./client";
import { shipmentEvents, type NewShipmentEvent, type Shipment } from "./schema";

const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

/** Runs `fn` and returns the Postgres error code it failed with (or throws if it succeeded). */
async function failureCode(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (error) {
    return pgErrorCode(error);
  }
  throw new Error("Expected the statement to be rejected, but it succeeded");
}

// These constraints back up Zod validation in the services; they do not replace it.
describe("database constraints", () => {
  let orgId: string;
  let userId: string;
  let shipment: Shipment;

  beforeAll(async () => {
    const org = await createTestOrganization();
    const actor = await createTestUser(org.id);
    orgId = org.id;
    userId = actor.id;
    shipment = await createTestShipment(org.id, actor.id);
  });

  const event = (overrides: Partial<NewShipmentEvent> = {}): NewShipmentEvent => ({
    organizationId: orgId,
    shipmentId: shipment.id,
    type: "status_changed",
    fromStatus: "created",
    toStatus: "picked_up",
    occurredAt: new Date(),
    actorUserId: userId,
    ...overrides,
  });

  describe("tenant consistency", () => {
    it("rejects an event whose organization differs from its shipment's", async () => {
      const otherOrg = await createTestOrganization("Other Org");

      const code = await failureCode(() =>
        db.insert(shipmentEvents).values(event({ organizationId: otherOrg.id })),
      );
      expect(code).toBe(FOREIGN_KEY_VIOLATION);
    });

    it("accepts an event in the shipment's own organization", async () => {
      await expect(db.insert(shipmentEvents).values(event())).resolves.toBeDefined();
    });
  });

  describe("shipments", () => {
    it.each([
      ["non-positive weight", { weightKg: 0 }],
      ["version below 1", { version: 0 }],
      ["latitude out of range", { originLat: 91 }],
      ["longitude out of range", { destinationLng: -181 }],
      ["lowercase country code", { originCountry: "nl" }],
      ["three-letter country code", { destinationCountry: "BEL" }],
    ])("rejects %s", async (_label, overrides) => {
      const code = await failureCode(() => createTestShipment(orgId, userId, overrides));
      expect(code).toBe(CHECK_VIOLATION);
    });

    it("accepts null coordinates and boundary values", async () => {
      await expect(
        createTestShipment(orgId, userId, {
          originLat: null,
          originLng: null,
          destinationLat: -90,
          destinationLng: 180,
        }),
      ).resolves.toMatchObject({ destinationLat: -90, destinationLng: 180 });
    });
  });

  describe("shipment_events", () => {
    it("rejects a location latitude out of range", async () => {
      const code = await failureCode(() =>
        db.insert(shipmentEvents).values(event({ locationLat: -90.5 })),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });

    it("rejects a location longitude out of range", async () => {
      const code = await failureCode(() =>
        db.insert(shipmentEvents).values(event({ locationLng: 200 })),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });

    it("rejects a status change without a target status", async () => {
      const code = await failureCode(() =>
        db.insert(shipmentEvents).values(event({ toStatus: null })),
      );
      expect(code).toBe(CHECK_VIOLATION);
    });
  });
});
