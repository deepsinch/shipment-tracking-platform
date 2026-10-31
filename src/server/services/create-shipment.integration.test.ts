import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { generateTrackingCode, isCanonicalTrackingCode } from "@/domain/tracking-code";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipmentEvents, shipments } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { createShipment, type CreateShipmentInput } from "./create-shipment";

/** What the "new shipment" form submits: strings, with blank optional fields. */
const formInput = (overrides: Partial<CreateShipmentInput> = {}): CreateShipmentInput => ({
  reference: " PO-1001 ",
  recipientName: "Grace Recipient",
  recipientEmail: "",
  originAddressLine: "Wilhelminakade 1",
  originCity: "Rotterdam",
  originPostalCode: "3072 AP",
  originCountry: "nl",
  originLat: "51.9",
  originLng: "4.48",
  destinationAddressLine: "Meir 1",
  destinationCity: "Antwerp",
  destinationPostalCode: "",
  destinationCountry: "BE",
  destinationLat: "",
  destinationLng: "",
  weightKg: "12.5",
  serviceLevel: "express",
  promisedDeliveryAt: "",
  assignedDriverId: "",
  ...overrides,
});

describe("createShipment", () => {
  let orgId: string;
  let dispatcher: AuthContext;

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
  });

  it("inserts the shipment and its created event, with a canonical tracking code", async () => {
    const result = await createShipment(dispatcher, formInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { shipment } = result;
    expect(isCanonicalTrackingCode(shipment.trackingCode)).toBe(true);
    expect(shipment).toMatchObject({
      organizationId: orgId,
      createdBy: dispatcher.userId,
      status: "created",
      version: 1,
      reference: "PO-1001",
      recipientEmail: null,
      originCountry: "NL",
      originLat: 51.9,
      destinationLat: null,
      weightKg: 12.5,
      serviceLevel: "express",
    });

    const events = await getDb()
      .select()
      .from(shipmentEvents)
      .where(eq(shipmentEvents.shipmentId, shipment.id));
    expect(events).toEqual([
      expect.objectContaining({
        organizationId: orgId,
        type: "created",
        fromStatus: null,
        toStatus: "created",
        actorUserId: dispatcher.userId,
        occurredAt: shipment.createdAt,
      }),
    ]);
  });

  it("allows admins", async () => {
    const admin = await createTestContext(orgId, "admin");
    const result = await createShipment(admin, formInput());
    expect(result.ok).toBe(true);
  });

  it("forbids drivers and writes nothing", async () => {
    const driver = await createTestContext(orgId, "driver");

    const result = await createShipment(driver, formInput());

    expect(result).toEqual({ ok: false, reason: "forbidden" });
    const rows = await getDb()
      .select({ id: shipments.id })
      .from(shipments)
      .where(eq(shipments.createdBy, driver.userId));
    expect(rows).toHaveLength(0);
  });

  it("returns field errors for invalid input and writes nothing", async () => {
    const result = await createShipment(
      dispatcher,
      formInput({
        recipientName: "  ",
        recipientEmail: "not-an-email",
        originCountry: "NLD",
        originLat: "95",
        weightKg: "0",
        serviceLevel: "overnight",
        reference: "unique-ref-that-must-not-be-stored",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== "validation")
      throw new Error("expected a validation failure");
    expect(Object.keys(result.fieldErrors).sort()).toEqual([
      "originCountry",
      "originLat",
      "recipientEmail",
      "recipientName",
      "serviceLevel",
      "weightKg",
    ]);
    const rows = await getDb()
      .select({ id: shipments.id })
      .from(shipments)
      .where(eq(shipments.reference, "unique-ref-that-must-not-be-stored"));
    expect(rows).toHaveLength(0);
  });

  it("reports missing required fields", async () => {
    const result = await createShipment(dispatcher, {});

    if (result.ok || result.reason !== "validation")
      throw new Error("expected a validation failure");
    expect(result.fieldErrors).toMatchObject({
      recipientName: ["Enter the recipient's name"],
      originCity: ["Enter the pickup city"],
      weightKg: ["Enter the weight in kg"],
    });
  });

  it("books at the injected time, for the shipment and its created event", async () => {
    const bookedAt = new Date("2026-10-20T09:15:00Z");

    const result = await createShipment(dispatcher, formInput(), { now: () => bookedAt });

    if (!result.ok) throw new Error("expected a shipment");
    expect(result.shipment.createdAt).toEqual(bookedAt);
    const [event] = await getDb()
      .select()
      .from(shipmentEvents)
      .where(eq(shipmentEvents.shipmentId, result.shipment.id));
    expect(event?.occurredAt).toEqual(bookedAt);
  });

  it("retries with a new tracking code when the generated one is taken", async () => {
    const existing = await createTestShipment(orgId, dispatcher.userId);
    const fresh = generateTrackingCode();
    const codes = [existing.trackingCode, existing.trackingCode, fresh];
    let calls = 0;

    const result = await createShipment(dispatcher, formInput(), {
      generateTrackingCode: () => codes[calls++]!,
    });

    expect(calls).toBe(3);
    expect(result.ok && result.shipment.trackingCode).toBe(fresh);
  });

  it("gives up after repeated collisions instead of looping forever", async () => {
    const existing = await createTestShipment(orgId, dispatcher.userId);

    await expect(
      createShipment(dispatcher, formInput(), {
        generateTrackingCode: () => existing.trackingCode,
      }),
    ).rejects.toThrow(/unique tracking code/);
  });

  describe("driver assignment", () => {
    it("assigns a driver from the same organization", async () => {
      const driver = await createTestContext(orgId, "driver");

      const result = await createShipment(
        dispatcher,
        formInput({ assignedDriverId: driver.userId }),
      );

      expect(result.ok && result.shipment.assignedDriverId).toBe(driver.userId);
    });

    it.each([
      ["a driver from another organization", "driver" as const, true],
      ["a dispatcher of the same organization", "dispatcher" as const, false],
    ])("rejects %s", async (_label, role, otherOrg) => {
      const targetOrg = otherOrg ? (await createTestOrganization()).id : orgId;
      const target = await createTestContext(targetOrg, role);

      const result = await createShipment(
        dispatcher,
        formInput({ assignedDriverId: target.userId }),
      );

      expect(result).toEqual({
        ok: false,
        reason: "validation",
        fieldErrors: { assignedDriverId: ["Choose a driver from your organization"] },
      });
    });
  });
});
