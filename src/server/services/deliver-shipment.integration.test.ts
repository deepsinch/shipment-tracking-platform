import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { PHOTO_MAX_BYTES, type Signature } from "@/domain/delivery-proof";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import {
  deliveryProofs,
  emailMessages,
  shipmentEvents,
  shipments,
  webhookDeliveries,
  type Shipment,
} from "@/server/db/schema";
import { createEnv } from "@/server/env";
import { createPhotoStorage } from "@/server/storage";
import {
  createMemoryPhotoStorage,
  type MemoryPhotoStorage,
} from "@/server/storage/memory-photo-storage";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { insertEndpoint } from "../../../tests/integration/webhooks";
import {
  asText,
  blobOf,
  GPS_MARKER,
  jpegWithExif,
  pngWithMetadata,
} from "../../../tests/photo-fixtures";
import { changeShipmentStatus } from "./change-shipment-status";
import { deliverShipment, type DeliverShipmentInput } from "./deliver-shipment";
import { findDeliveryProof, getDeliveryPhoto } from "./delivery-proof";
import { getShipment } from "./get-shipment";
import { getPublicTracking } from "./public-tracking";

// Nothing here reaches the real Blob service; the demo test asserts that with this mock.
const blobSdk = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), del: vi.fn() }));
vi.mock("@vercel/blob", () => blobSdk);

const signature: Signature = {
  aspect: 2,
  strokes: [
    [
      [0.1, 0.5],
      [0.4, 0.3],
      [0.8, 0.6],
    ],
  ],
};

describe("deliverShipment", () => {
  let orgId: string;
  let dispatcher: AuthContext;
  let driver: AuthContext;
  let storage: MemoryPhotoStorage;

  beforeAll(async () => {
    orgId = (await createTestOrganization("Proof Freight")).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
    driver = await createTestContext(orgId, "driver");
  });

  afterEach(() => {
    blobSdk.put.mockReset();
  });

  /** A shipment out for delivery, assigned to `driver`. */
  const outForDelivery = (overrides: Partial<Shipment> = {}) =>
    createTestShipment(orgId, dispatcher.userId, {
      status: "out_for_delivery",
      assignedDriverId: driver.userId,
      ...overrides,
    });

  const deliver = (
    shipment: Shipment,
    input: Partial<DeliverShipmentInput> = {},
    ctx: AuthContext = driver,
    photoStorage: MemoryPhotoStorage | null = storage,
  ) =>
    deliverShipment(
      ctx,
      {
        shipmentId: shipment.id,
        expectedVersion: shipment.version,
        recipientName: "Ada Recipient",
        ...input,
      },
      { photoStorage },
    );

  const proofsOf = (shipmentId: string) =>
    getDb().select().from(deliveryProofs).where(eq(deliveryProofs.shipmentId, shipmentId));
  const eventsOf = (shipmentId: string) =>
    getDb().select().from(shipmentEvents).where(eq(shipmentEvents.shipmentId, shipmentId));
  const reload = async (shipmentId: string) =>
    (await getDb().select().from(shipments).where(eq(shipments.id, shipmentId)))[0]!;

  /** The shipment is exactly as it was: not delivered, no proof, no new event. */
  async function expectNotDelivered(shipment: Shipment) {
    expect(await proofsOf(shipment.id)).toEqual([]);
    expect((await reload(shipment.id)).status).toBe("out_for_delivery");
    expect((await reload(shipment.id)).version).toBe(shipment.version);
    expect((await eventsOf(shipment.id)).map((event) => event.type)).toEqual(["created"]);
  }

  // Each test gets its own storage fake.
  beforeAll(() => {
    storage = createMemoryPhotoStorage();
  });
  afterEach(() => {
    storage = createMemoryPhotoStorage();
  });

  it("writes the proof with the delivered event: the name, the strokes and the actor", async () => {
    const shipment = await outForDelivery();

    const result = await deliver(shipment, {
      recipientName: "  Ada R.  ",
      signature: JSON.stringify(signature),
    });
    if (!result.ok) throw new Error(JSON.stringify(result));

    expect(result.shipment.status).toBe("delivered");
    const [proof, ...rest] = await proofsOf(shipment.id);
    expect(rest).toEqual([]);
    expect(proof).toMatchObject({
      organizationId: orgId,
      shipmentId: shipment.id,
      eventId: result.event.id,
      recipientName: "Ada R.",
      signature,
      photoKey: null,
      capturedBy: driver.userId,
    });
    expect(result.event).toMatchObject({ type: "status_changed", toStatus: "delivered" });
  });

  it("delivers with the printed name alone (no signature, no photo)", async () => {
    const shipment = await outForDelivery();
    const result = await deliver(shipment);
    expect(result.ok).toBe(true);
    const [proof] = await proofsOf(shipment.id);
    expect(proof).toMatchObject({
      recipientName: "Ada Recipient",
      signature: null,
      photoKey: null,
    });
  });

  describe("atomicity", () => {
    // A trigger that fails the webhook delivery insert for one organization: the last thing the
    // status change's transaction does, after the event and the proof are written.
    async function withFailingOutbox<T>(organizationId: string, run: () => Promise<T>): Promise<T> {
      const name = `fail_${randomUUID().replaceAll("-", "")}`;
      await getDb().execute(
        sql.raw(`
        CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'forced failure after the proof was written'; END; $$`),
      );
      await getDb().execute(
        sql.raw(`
        CREATE TRIGGER ${name} BEFORE INSERT ON webhook_deliveries
        FOR EACH ROW WHEN (NEW.organization_id = '${organizationId}') EXECUTE FUNCTION ${name}()`),
      );
      try {
        return await run();
      } finally {
        await getDb().execute(sql.raw(`DROP TRIGGER ${name} ON webhook_deliveries`));
        await getDb().execute(sql.raw(`DROP FUNCTION ${name}()`));
      }
    }

    it("leaves no proof, no event, no delivery and no photo when the transaction rolls back", async () => {
      const org = (await createTestOrganization("Rollback Freight")).id;
      const office = await createTestContext(org, "dispatcher");
      const truck = await createTestContext(org, "driver");
      await insertEndpoint(org, office.userId);
      const shipment = await createTestShipment(org, office.userId, {
        status: "out_for_delivery",
        assignedDriverId: truck.userId,
      });

      await expect(
        withFailingOutbox(org, () =>
          deliverShipment(
            truck,
            {
              shipmentId: shipment.id,
              expectedVersion: 1,
              recipientName: "Ada Recipient",
              signature: JSON.stringify(signature),
              photo: blobOf(jpegWithExif()),
            },
            { photoStorage: storage },
          ),
        ),
      ).rejects.toThrow();

      expect(await proofsOf(shipment.id)).toEqual([]);
      expect((await reload(shipment.id)).status).toBe("out_for_delivery");
      expect((await eventsOf(shipment.id)).map((event) => event.type)).toEqual(["created"]);
      // The photo was uploaded first and is taken out again.
      expect(storage.puts).toHaveLength(1);
      expect(storage.deletes).toEqual(storage.puts);
      expect(storage.files.size).toBe(0);
    });
  });

  describe("who may deliver", () => {
    it("does not let a driver attach proof to a shipment assigned to someone else", async () => {
      const shipment = await outForDelivery({ assignedDriverId: null });

      const result = await deliver(shipment, { photo: blobOf(jpegWithExif()) });

      expect(result).toEqual({ ok: false, reason: "not_found" });
      expect(storage.puts).toEqual([]);
      await expectNotDelivered(shipment);
    });

    it("does not let a driver in another organization touch it", async () => {
      const shipment = await outForDelivery();
      const otherOrg = (await createTestOrganization()).id;
      const stranger = await createTestContext(otherOrg, "driver");

      const result = await deliver(shipment, { photo: blobOf(jpegWithExif()) }, stranger);

      expect(result).toEqual({ ok: false, reason: "not_found" });
      expect(storage.puts).toEqual([]);
      await expectNotDelivered(shipment);
    });

    it("answers a malformed id like an unknown one", async () => {
      const shipment = await outForDelivery();
      expect(await deliver({ ...shipment, id: "not-a-uuid" })).toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    it("requires a driver's delivery to carry the recipient's name, at every entry point", async () => {
      const shipment = await outForDelivery();

      const viaStatus = await changeShipmentStatus(driver, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "delivered",
      });
      expect(viaStatus).toMatchObject({
        ok: false,
        reason: "validation",
        fieldErrors: { recipientName: [expect.any(String)] },
      });

      const blank = await deliver(shipment, { recipientName: "   " });
      expect(blank).toMatchObject({
        ok: false,
        reason: "validation",
        fieldErrors: { recipientName: [expect.any(String)] },
      });
      await expectNotDelivered(shipment);
    });

    it("lets staff mark a delivery without proof, which records none", async () => {
      const shipment = await outForDelivery();

      const result = await changeShipmentStatus(dispatcher, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "delivered",
      });

      expect(result.ok).toBe(true);
      expect(await proofsOf(shipment.id)).toEqual([]);
      expect(await findDeliveryProof(orgId, shipment.id)).toBeNull();
    });

    it("refuses proof with any other status", async () => {
      const shipment = await outForDelivery();
      const result = await changeShipmentStatus(
        driver,
        { shipmentId: shipment.id, expectedVersion: 1, toStatus: "exception" },
        { proof: { recipientName: "Ada", signature: null, photoKey: null } },
      );
      expect(result).toMatchObject({ ok: false, reason: "validation" });
      await expectNotDelivered(shipment);
    });

    it("keeps the state machine and concurrency rules: a stale form delivers nothing", async () => {
      const shipment = await outForDelivery();

      const stale = await deliver(shipment, { expectedVersion: 7, photo: blobOf(jpegWithExif()) });

      expect(stale).toMatchObject({ ok: false, reason: "conflict" });
      await expectNotDelivered(shipment);
      // The photo that went up ahead of the check is removed again.
      expect(storage.puts).toHaveLength(1);
      expect(storage.files.size).toBe(0);

      const created = await createTestShipment(orgId, dispatcher.userId, {
        assignedDriverId: driver.userId,
      });
      expect(await deliver(created)).toMatchObject({ ok: false, reason: "invalid_transition" });
    });
  });

  describe("signature", () => {
    it.each([
      ["not JSON", "{broken"],
      ["a point outside the pad", JSON.stringify({ aspect: 2, strokes: [[[2, 2]]] })],
      ["no strokes", JSON.stringify({ aspect: 2, strokes: [] })],
    ])("refuses %s and delivers nothing", async (_label, bad) => {
      const shipment = await outForDelivery();
      const result = await deliver(shipment, { signature: bad });
      expect(result).toMatchObject({
        ok: false,
        reason: "validation",
        fieldErrors: { signature: [expect.any(String)] },
      });
      await expectNotDelivered(shipment);
    });

    it("refuses strokes over the size cap", async () => {
      const shipment = await outForDelivery();
      const point = [0.123456789012345, 0.123456789012345];
      const huge = JSON.stringify({
        aspect: 2,
        strokes: Array.from({ length: 80 }, () => Array.from({ length: 20 }, () => point)),
      });
      const result = await deliver(shipment, { signature: huge });
      expect(result).toMatchObject({ ok: false, fieldErrors: { signature: [expect.any(String)] } });
      await expectNotDelivered(shipment);
    });
  });

  describe("photo", () => {
    it("stores a cleaned copy under an unguessable key and records only the key", async () => {
      const shipment = await outForDelivery();
      const original = jpegWithExif();
      expect(asText(original)).toContain(GPS_MARKER);

      const result = await deliver(shipment, { photo: blobOf(original) });
      if (!result.ok) throw new Error(JSON.stringify(result));

      const [proof] = await proofsOf(shipment.id);
      expect(proof!.photoKey).toMatch(
        new RegExp(`^delivery-proofs/${orgId}/${shipment.id}/[0-9a-f-]{36}\\.jpg$`),
      );
      expect(storage.puts).toEqual([proof!.photoKey]);
      const stored = storage.files.get(proof!.photoKey!)!;
      expect(stored.contentType).toBe("image/jpeg");
      // The location is gone before anything is stored.
      expect(asText(stored.bytes)).not.toContain("GPS");
    });

    it("strips a PNG too, and sniffs the type from the bytes rather than the claim", async () => {
      const shipment = await outForDelivery();
      const result = await deliver(shipment, { photo: blobOf(pngWithMetadata(), "image/jpeg") });
      expect(result.ok).toBe(true);
      const [file] = [...storage.files.values()];
      expect(file!.contentType).toBe("image/png");
      expect(asText(file!.bytes)).not.toContain("GPS");
    });

    it.each([
      ["an SVG that claims to be a JPEG", new TextEncoder().encode("<svg onload=alert(1)/>")],
      ["HTML", new TextEncoder().encode("<script>alert(1)</script>")],
      ["a truncated JPEG", jpegWithExif().subarray(0, 40)],
    ])("refuses %s, stores nothing and delivers nothing", async (_label, bytes) => {
      const shipment = await outForDelivery();
      const result = await deliver(shipment, { photo: blobOf(bytes as Uint8Array, "image/jpeg") });
      expect(result).toMatchObject({
        ok: false,
        reason: "validation",
        fieldErrors: { photo: [expect.any(String)] },
      });
      expect(storage.puts).toEqual([]);
      await expectNotDelivered(shipment);
    });

    it("refuses a photo over the size limit without reading it", async () => {
      const shipment = await outForDelivery();
      const tooBig = new Blob([new Uint8Array(PHOTO_MAX_BYTES + 1)], { type: "image/jpeg" });
      const arrayBuffer = vi.spyOn(tooBig, "arrayBuffer");

      const result = await deliver(shipment, { photo: tooBig });

      expect(result).toMatchObject({
        ok: false,
        fieldErrors: { photo: [expect.stringContaining("too large")] },
      });
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(storage.puts).toEqual([]);
    });

    it("tells the driver when the store is down, and delivers nothing", async () => {
      const shipment = await outForDelivery();
      const failing = {
        ...createMemoryPhotoStorage(),
        put: () => Promise.reject(new Error("503")),
      };
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await deliverShipment(
        driver,
        {
          shipmentId: shipment.id,
          expectedVersion: 1,
          recipientName: "Ada",
          photo: blobOf(jpegWithExif()),
        },
        { photoStorage: failing },
      );

      quiet.mockRestore();
      expect(result).toEqual({ ok: false, reason: "photo_failed" });
      await expectNotDelivered(shipment);
    });
  });

  describe("without photo storage (not configured, or demo mode)", () => {
    it("refuses a photo and stores nothing, anywhere", async () => {
      const shipment = await outForDelivery();
      const result = await deliver(shipment, { photo: blobOf(jpegWithExif()) }, driver, null);
      expect(result).toMatchObject({
        ok: false,
        reason: "validation",
        fieldErrors: { photo: [expect.any(String)] },
      });
      await expectNotDelivered(shipment);
    });

    it("demo mode builds no storage even with a Blob token, so no file can reach the store", async () => {
      const demo = createEnv({
        DEMO_MODE: "true",
        BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_token",
      }).photos;
      const demoStorage = createPhotoStorage(demo);
      expect(demoStorage).toBeNull();

      const shipment = await outForDelivery();
      const result = await deliverShipment(
        driver,
        {
          shipmentId: shipment.id,
          expectedVersion: 1,
          recipientName: "Ada",
          photo: blobOf(jpegWithExif()),
        },
        { photoStorage: demoStorage },
      );

      expect(result).toMatchObject({ ok: false, fieldErrors: { photo: [expect.any(String)] } });
      expect(blobSdk.put).not.toHaveBeenCalled();
      await expectNotDelivered(shipment);

      // The name and the signature still work in demo mode.
      const signed = await deliverShipment(
        driver,
        {
          shipmentId: shipment.id,
          expectedVersion: 1,
          recipientName: "Ada",
          signature: JSON.stringify(signature),
        },
        { photoStorage: demoStorage },
      );
      expect(signed.ok).toBe(true);
      expect(blobSdk.put).not.toHaveBeenCalled();
    });
  });

  describe("what each audience sees", () => {
    let shipment: Shipment;
    let eventId: string;

    // Not the per-test fake: these tests read what the one delivery below stored.
    const audienceStorage = createMemoryPhotoStorage();

    beforeAll(async () => {
      shipment = await outForDelivery({ recipientEmail: `ada-${randomUUID()}@example.test` });
      await insertEndpoint(orgId, dispatcher.userId);
      const result = await deliver(
        shipment,
        {
          recipientName: "Ada R.",
          signature: JSON.stringify(signature),
          photo: blobOf(jpegWithExif()),
        },
        driver,
        audienceStorage,
      );
      if (!result.ok) throw new Error(JSON.stringify(result));
      eventId = result.event.id;
    });

    it("gives the public page the printed name and nothing else of the proof", async () => {
      const tracking = (await getPublicTracking(shipment.trackingCode))!;

      expect(tracking.status).toBe("delivered");
      expect(tracking.signedBy).toBe("Ada R.");
      expect(Object.keys(tracking).sort()).toEqual([
        "destination",
        "origin",
        "promisedDeliveryAt",
        "signedBy",
        "status",
        "timeline",
        "trackingCode",
      ]);
      const text = JSON.stringify(tracking);
      expect(text).not.toContain("strokes");
      expect(text).not.toContain("delivery-proofs/");
      expect(text).not.toContain("hasPhoto");
    });

    it("says nothing about a signer for a delivery without proof, or before delivery", async () => {
      const office = await outForDelivery();
      expect((await getPublicTracking(office.trackingCode))!.signedBy).toBeNull();
      await changeShipmentStatus(dispatcher, {
        shipmentId: office.id,
        expectedVersion: 1,
        toStatus: "delivered",
      });
      expect((await getPublicTracking(office.trackingCode))!.signedBy).toBeNull();
    });

    it("queues a webhook that carries the name and two booleans, not the evidence", async () => {
      const rows = await getDb()
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.eventType, "shipment.status_changed"));
      const mine = rows.find(
        (row) =>
          (row.payload as { data: { shipment: { id: string } } }).data.shipment.id === shipment.id,
      )!;
      const { data } = mine.payload as { data: { change: Record<string, unknown> } };

      expect(data.change.proof).toEqual({
        recipientName: "Ada R.",
        hasSignature: true,
        hasPhoto: true,
      });
      const text = JSON.stringify(mine.payload);
      expect(text).not.toContain("strokes");
      expect(text).not.toContain("delivery-proofs/");
      expect(eventId).toBeTruthy();
    });

    it("tells the customer who signed", async () => {
      const [message] = await getDb()
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.shipmentId, shipment.id));
      expect(message!.textBody).toContain("Signed by: Ada R.");
      expect(message!.htmlBody).toContain("Ada R.");
      expect(message!.textBody).not.toContain("strokes");
    });

    it("gives staff the proof without the storage key", async () => {
      const result = await getShipment(dispatcher, shipment.id);
      if (!result.ok) throw new Error("not found");

      expect(result.proof).toMatchObject({
        recipientName: "Ada R.",
        signature,
        photo: "stored",
        capturedByName: expect.any(String),
      });
      expect(JSON.stringify(result.proof)).not.toContain("delivery-proofs/");
    });

    it("serves the photo to staff only, and only within their organization", async () => {
      const photo = await getDeliveryPhoto(dispatcher, shipment.id, {
        photoStorage: audienceStorage,
      });
      if (!photo.ok) throw new Error(JSON.stringify(photo));
      expect(photo.contentType).toBe("image/jpeg");
      const bytes = new Uint8Array(await new Response(photo.body).arrayBuffer());
      expect(asText(bytes)).not.toContain("GPS");

      // Not even the driver who took it.
      expect(
        await getDeliveryPhoto(driver, shipment.id, { photoStorage: audienceStorage }),
      ).toEqual({
        ok: false,
        reason: "forbidden",
      });
      const stranger = await createTestContext((await createTestOrganization()).id, "admin");
      expect(
        await getDeliveryPhoto(stranger, shipment.id, { photoStorage: audienceStorage }),
      ).toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(
        await getDeliveryPhoto(dispatcher, "not-a-uuid", { photoStorage: audienceStorage }),
      ).toEqual({
        ok: false,
        reason: "not_found",
      });
    });

    it("has no photo to serve for a delivery without one or the demo's placeholder", async () => {
      const nameOnly = await outForDelivery();
      await deliver(nameOnly);
      expect(
        await getDeliveryPhoto(dispatcher, nameOnly.id, { photoStorage: audienceStorage }),
      ).toEqual({
        ok: false,
        reason: "not_found",
      });

      const sample = await outForDelivery();
      const result = await changeShipmentStatus(
        driver,
        { shipmentId: sample.id, expectedVersion: 1, toStatus: "delivered" },
        { proof: { recipientName: "Ada", signature: null, photoKey: "demo/sample" } },
      );
      expect(result.ok).toBe(true);
      expect(
        await getDeliveryPhoto(dispatcher, sample.id, { photoStorage: audienceStorage }),
      ).toEqual({
        ok: false,
        reason: "not_found",
      });
      expect((await findDeliveryProof(orgId, sample.id))!.photo).toBe("sample");
    });
  });
});
