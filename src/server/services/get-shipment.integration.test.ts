import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipmentEvents, user, type Shipment } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
  createTestUser,
} from "../../../tests/integration/fixtures";
import { getShipment } from "./get-shipment";

describe("getShipment", () => {
  let dispatcher: AuthContext;
  let shipment: Shipment;

  beforeAll(async () => {
    const orgId = (await createTestOrganization()).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
    shipment = await createTestShipment(orgId, dispatcher.userId, {
      createdAt: new Date("2026-03-01T08:00:00Z"),
    });
    // Recorded out of order (a driver syncing late): the timeline follows occurred_at.
    await getDb()
      .insert(shipmentEvents)
      .values([
        {
          organizationId: orgId,
          shipmentId: shipment.id,
          type: "status_changed",
          fromStatus: "picked_up",
          toStatus: "in_transit",
          occurredAt: new Date("2026-03-01T12:00:00Z"),
        },
        {
          organizationId: orgId,
          shipmentId: shipment.id,
          type: "status_changed",
          fromStatus: "created",
          toStatus: "picked_up",
          occurredAt: new Date("2026-03-01T10:00:00Z"),
        },
      ]);
  });

  it("returns the shipment with its timeline in real-world order", async () => {
    const result = await getShipment(dispatcher, shipment.id);

    if (!result.ok) throw new Error("expected the shipment");
    expect(result.shipment.id).toBe(shipment.id);
    expect(result.events.map((event) => event.toStatus)).toEqual([
      "created",
      "picked_up",
      "in_transit",
    ]);
  });

  it("names the actor of each event, and null for system events", async () => {
    await getDb()
      .update(user)
      .set({ name: "Dana Dispatcher" })
      .where(eq(user.id, dispatcher.userId));

    const result = await getShipment(dispatcher, shipment.id);

    if (!result.ok) throw new Error("expected the shipment");
    // The created event was recorded by the dispatcher; the two status changes have no actor.
    expect(result.events.map((event) => event.actorName)).toEqual(["Dana Dispatcher", null, null]);
  });

  it("names the assigned driver, or null when unassigned", async () => {
    expect(await getShipment(dispatcher, shipment.id)).toMatchObject({ assignedDriverName: null });

    const driver = await createTestUser(dispatcher.organizationId, "driver");
    const assigned = await createTestShipment(dispatcher.organizationId, dispatcher.userId, {
      assignedDriverId: driver.id,
    });

    expect(await getShipment(dispatcher, assigned.id)).toMatchObject({
      assignedDriverName: driver.name,
    });
  });

  it("returns not_found for another organization's shipment", async () => {
    const outsider = await createTestContext((await createTestOrganization()).id, "admin");

    expect(await getShipment(outsider, shipment.id)).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_found for an unknown or malformed id", async () => {
    expect(await getShipment(dispatcher, randomUUID())).toEqual({ ok: false, reason: "not_found" });
    expect(await getShipment(dispatcher, "not-a-uuid")).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_found to a driver the shipment is not assigned to", async () => {
    const driver = await createTestContext(dispatcher.organizationId, "driver");

    expect(await getShipment(driver, shipment.id)).toEqual({ ok: false, reason: "not_found" });
  });
});
