import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { webhookDeliveries } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { insertEndpoint } from "../../../tests/integration/webhooks";
import { assignDriver } from "./assign-driver";
import { changeShipmentStatus } from "./change-shipment-status";
import { createShipment } from "./create-shipment";
import { enqueueShipmentCreated } from "./webhook-outbox";

const NEW_SHIPMENT = {
  recipientName: "Ada Recipient",
  originAddressLine: "1 Origin Street",
  originCity: "Rotterdam",
  originCountry: "NL",
  destinationAddressLine: "2 Destination Road",
  destinationCity: "Antwerp",
  destinationCountry: "BE",
  weightKg: 12.5,
};

const keys = (value: unknown) => Object.keys(value as object).sort();

describe("webhook outbox", () => {
  let admin: AuthContext;
  let driver: AuthContext;
  let all: { id: string };
  let statusOnly: { id: string };
  let disabled: { id: string };
  let otherOrgEndpoint: { id: string };

  const deliveriesFor = async (endpointIds: string[]) =>
    getDb()
      .select()
      .from(webhookDeliveries)
      .where(inArray(webhookDeliveries.endpointId, endpointIds));

  beforeAll(async () => {
    const org = await createTestOrganization();
    admin = await createTestContext(org.id, "admin");
    driver = await createTestContext(org.id, "driver");
    all = await insertEndpoint(org.id, admin.userId);
    statusOnly = await insertEndpoint(org.id, admin.userId, {
      eventTypes: ["shipment.status_changed"],
    });
    disabled = await insertEndpoint(org.id, admin.userId, {
      enabled: false,
      disabledReason: "manual",
    });
    const other = await createTestOrganization("Other");
    const otherAdmin = await createTestContext(other.id, "admin");
    otherOrgEndpoint = await insertEndpoint(other.id, otherAdmin.userId);
  });

  const ids = () => [all.id, statusOnly.id, disabled.id, otherOrgEndpoint.id];

  it("queues shipment.created for each enabled endpoint that subscribed, in its own organization", async () => {
    const result = await createShipment(admin, NEW_SHIPMENT);
    if (!result.ok) throw new Error("create failed");

    const rows = (await deliveriesFor(ids())).filter(
      (row) => row.eventType === "shipment.created" && row.payload.data !== undefined,
    );
    const mine = rows.filter(
      (row) =>
        (row.payload.data as { shipment: { id: string } }).shipment.id === result.shipment.id,
    );
    expect(mine.map((row) => row.endpointId)).toEqual([all.id]);

    const [delivery] = mine;
    expect(delivery).toMatchObject({ status: "pending", attempts: 0, lastError: null });
    expect(delivery!.nextAttemptAt).toBeInstanceOf(Date);
    expect(delivery!.payload).toMatchObject({
      id: delivery!.eventId,
      type: "shipment.created",
      data: { version: 1, shipment: { id: result.shipment.id, status: "created" } },
    });
  });

  it("queues shipment.status_changed with one shared event id", async () => {
    const shipment = await createTestShipment(admin.organizationId, admin.userId);
    const result = await changeShipmentStatus(admin, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "picked_up",
      publicNote: "Collected",
      internalNote: "Gate code 1234",
    });
    if (!result.ok) throw new Error("status failed");

    const rows = (await deliveriesFor(ids())).filter(
      (row) => (row.payload.data as { shipment?: { id: string } }).shipment?.id === shipment.id,
    );
    expect(rows.map((row) => row.endpointId).sort()).toEqual([all.id, statusOnly.id].sort());
    expect(new Set(rows.map((row) => row.eventId)).size).toBe(1);

    const payload = rows[0]!.payload as {
      type: string;
      data: { version: number; change: Record<string, unknown> };
    };
    expect(payload.type).toBe("shipment.status_changed");
    expect(payload.data.version).toBe(2);
    expect(keys(payload.data.change)).toEqual([
      "fromStatus",
      "location",
      "occurredAt",
      "publicNote",
      "toStatus",
    ]);
    expect(payload.data.change).toMatchObject({
      fromStatus: "created",
      toStatus: "picked_up",
      publicNote: "Collected",
    });
    // Internal notes stay inside the company.
    expect(JSON.stringify(payload)).not.toContain("Gate code");
  });

  it("queues shipment.driver_assigned with names, never user ids", async () => {
    const shipment = await createTestShipment(admin.organizationId, admin.userId);
    const result = await assignDriver(admin, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      driverId: driver.userId,
    });
    if (!result.ok) throw new Error("assign failed");

    const rows = (await deliveriesFor(ids())).filter(
      (row) => (row.payload.data as { shipment?: { id: string } }).shipment?.id === shipment.id,
    );
    expect(rows.map((row) => row.endpointId)).toEqual([all.id]);
    const payload = rows[0]!.payload;
    expect(payload).toMatchObject({
      type: "shipment.driver_assigned",
      data: { assignment: { fromDriverName: null, toDriverName: "Test driver" } },
    });
    const text = JSON.stringify(payload);
    for (const internal of [driver.userId, admin.userId, admin.organizationId]) {
      expect(text).not.toContain(internal);
    }
  });

  it("queues nothing for a change that did not happen", async () => {
    const shipment = await createTestShipment(admin.organizationId, admin.userId);
    const before = (await deliveriesFor(ids())).length;

    const stale = await changeShipmentStatus(admin, {
      shipmentId: shipment.id,
      expectedVersion: 7,
      toStatus: "picked_up",
    });
    const invalid = await changeShipmentStatus(admin, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "delivered",
    });

    expect(stale).toMatchObject({ ok: false, reason: "conflict" });
    expect(invalid).toMatchObject({ ok: false, reason: "invalid_transition" });
    expect((await deliveriesFor(ids())).length).toBe(before);
  });

  it("leaves no delivery behind when the transaction rolls back", async () => {
    const shipment = await createTestShipment(admin.organizationId, admin.userId);

    await expect(
      getDb().transaction(async (tx) => {
        await enqueueShipmentCreated(tx, shipment);
        // The outbox row is visible inside the transaction...
        const inside = await tx
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.endpointId, all.id));
        expect(
          inside.some(
            (row) => (row.payload.data as { shipment: { id: string } }).shipment.id === shipment.id,
          ),
        ).toBe(true);
        throw new Error("the change failed after queueing");
      }),
    ).rejects.toThrow("the change failed");

    // ...and gone with it.
    const after = await deliveriesFor(ids());
    expect(
      after.some(
        (row) => (row.payload.data as { shipment?: { id: string } }).shipment?.id === shipment.id,
      ),
    ).toBe(false);
  });

  it("does not queue anything when no endpoint exists for the organization", async () => {
    const lonely = await createTestOrganization("No endpoints");
    const ctx = await createTestContext(lonely.id, "admin");
    const result = await createShipment(ctx, NEW_SHIPMENT);
    expect(result.ok).toBe(true);
    const rows = await getDb()
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.organizationId, lonely.id));
    expect(rows).toEqual([]);
  });

  it("uses a fresh uuid event id per event", async () => {
    const shipment = await createTestShipment(admin.organizationId, admin.userId);
    await getDb().transaction(async (tx) => {
      await enqueueShipmentCreated(tx, shipment);
      await enqueueShipmentCreated(tx, shipment);
    });
    const rows = (await deliveriesFor([all.id])).filter(
      (row) => (row.payload.data as { shipment?: { id: string } }).shipment?.id === shipment.id,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.eventId).not.toBe(rows[1]!.eventId);
    expect(rows[0]!.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
