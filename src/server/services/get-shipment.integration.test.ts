import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipmentEvents, type Shipment } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
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
