import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { MAX_WEBHOOK_ENDPOINTS, WEBHOOK_EVENT_TYPES } from "@/domain/webhooks";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { webhookDeliveries, webhookEndpoints } from "@/server/db/schema";

import { createTestContext, createTestOrganization } from "../../../tests/integration/fixtures";
import { insertDelivery, insertEndpoint } from "../../../tests/integration/webhooks";
import {
  createWebhookEndpoint,
  DELIVERY_LOG_LENGTH,
  listWebhookEndpoints,
  resendWebhookDelivery,
  rotateWebhookSecret,
  setWebhookEndpointEnabled,
} from "./webhook-endpoints";

const URL_OK = "https://hooks.example.com/waybill";
const INPUT = { url: URL_OK, eventTypes: ["shipment.status_changed"] };

const rowOf = async (id: string) => {
  const [row] = await getDb().select().from(webhookEndpoints).where(eq(webhookEndpoints.id, id));
  return row!;
};

describe("webhook endpoints", () => {
  let admin: AuthContext;
  let dispatcher: AuthContext;
  let driver: AuthContext;
  let api: AuthContext;
  let outsider: AuthContext;

  // A fresh organization per test: the number of endpoints is limited per organization.
  beforeEach(async () => {
    const orgId = (await createTestOrganization()).id;
    admin = await createTestContext(orgId, "admin");
    dispatcher = await createTestContext(orgId, "dispatcher");
    driver = await createTestContext(orgId, "driver");
    api = { ...admin, role: "api" };
    outsider = await createTestContext((await createTestOrganization("Other")).id, "admin");
  });

  async function create(ctx = admin, input: unknown = INPUT) {
    const result = await createWebhookEndpoint(ctx, input);
    if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result)}`);
    return result;
  }

  describe("createWebhookEndpoint", () => {
    it("returns the secret once; it is a random 256-bit whsec_ key", async () => {
      const { endpoint, secret } = await create(admin, {
        url: ` ${URL_OK} `,
        eventTypes: ["shipment.created", "shipment.created", "shipment.driver_assigned"],
      });

      expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
      expect(endpoint).toMatchObject({
        url: URL_OK,
        eventTypes: ["shipment.created", "shipment.driver_assigned"],
        enabled: true,
        disabledReason: null,
        createdByName: "Test admin",
      });
      expect(Object.keys(endpoint)).not.toContain("secret");
      // Stored as is, because signing needs the key itself (decision 58).
      expect((await rowOf(endpoint.id)).secret).toBe(secret);
      expect((await create()).secret).not.toBe(secret);
    });

    it("is for admins only", async () => {
      for (const ctx of [dispatcher, driver, api]) {
        expect(await createWebhookEndpoint(ctx, INPUT)).toEqual({ ok: false, reason: "forbidden" });
      }
    });

    it.each([
      [{ url: "", eventTypes: ["shipment.created"] }, "url", /Enter the URL/],
      [{ url: "http://hooks.example.com/", eventTypes: ["shipment.created"] }, "url", /https/],
      [{ url: "https://10.0.0.1/hook", eventTypes: ["shipment.created"] }, "url", /private/],
      [{ url: "https://localhost/hook", eventTypes: ["shipment.created"] }, "url", /public host/],
      [{ url: "https://169.254.169.254/", eventTypes: ["shipment.created"] }, "url", /metadata/],
      [{ url: URL_OK, eventTypes: [] }, "eventTypes", /at least one event/],
      [{ url: URL_OK }, "eventTypes", /at least one event/],
      [{ url: URL_OK, eventTypes: ["shipment.deleted"] }, "eventTypes", /listed events/],
    ])("validates %j", async (input, field, message) => {
      const result = await createWebhookEndpoint(admin, input);
      expect(result).toMatchObject({ ok: false, reason: "validation" });
      expect(
        !result.ok && result.reason === "validation" && result.fieldErrors[field]?.[0],
      ).toMatch(message);
    });

    it("accepts a single event sent as a string (a one-box checkbox group)", async () => {
      const { endpoint } = await create(admin, { url: URL_OK, eventTypes: "shipment.created" });
      expect(endpoint.eventTypes).toEqual(["shipment.created"]);
    });

    it("limits the number of endpoints per organization", async () => {
      const orgId = (await createTestOrganization("Busy")).id;
      const busy = await createTestContext(orgId, "admin");
      for (let i = 0; i < MAX_WEBHOOK_ENDPOINTS; i++) await create(busy);
      expect(await createWebhookEndpoint(busy, INPUT)).toEqual({
        ok: false,
        reason: "limit",
        max: MAX_WEBHOOK_ENDPOINTS,
      });
    });

    it("is backed by CHECK constraints, not only by Zod", async () => {
      await expect(
        insertEndpoint(admin.organizationId, admin.userId, { eventTypes: ["shipment.deleted"] }),
      ).rejects.toThrow();
      await expect(
        insertEndpoint(admin.organizationId, admin.userId, { eventTypes: [] }),
      ).rejects.toThrow();
    });
  });

  describe("listWebhookEndpoints", () => {
    it("lists the organization's endpoints newest first, without secrets or payloads", async () => {
      const orgId = (await createTestOrganization("Lister")).id;
      const lister = await createTestContext(orgId, "admin");
      const first = await create(lister);
      const second = await create(lister);
      const delivery = await insertDelivery({ id: first.endpoint.id, organizationId: orgId });

      const result = await listWebhookEndpoints(lister);
      if (!result.ok) throw new Error("forbidden");

      expect(result.endpoints.map((endpoint) => endpoint.id)).toEqual([
        second.endpoint.id,
        first.endpoint.id,
      ]);
      const listed = result.endpoints[1]!;
      expect(Object.keys(listed).sort()).toEqual([
        "createdAt",
        "createdByName",
        "deliveries",
        "disabledReason",
        "enabled",
        "eventTypes",
        "id",
        "url",
      ]);
      expect(Object.keys(listed.deliveries[0]!).sort()).toEqual([
        "attempts",
        "createdAt",
        "eventId",
        "eventType",
        "id",
        "lastAttemptAt",
        "lastError",
        "lastStatusCode",
        "nextAttemptAt",
        "status",
      ]);
      expect(listed.deliveries[0]!.id).toBe(delivery.id);
      expect(JSON.stringify(result)).not.toContain(first.secret);
    });

    it("shows the latest deliveries only", async () => {
      const orgId = (await createTestOrganization("Long log")).id;
      const ctx = await createTestContext(orgId, "admin");
      const { endpoint } = await create(ctx);
      for (let i = 0; i < DELIVERY_LOG_LENGTH + 3; i++) {
        await insertDelivery({ id: endpoint.id, organizationId: orgId });
      }
      const result = await listWebhookEndpoints(ctx);
      expect(result.ok && result.endpoints[0]!.deliveries).toHaveLength(DELIVERY_LOG_LENGTH);
    });

    it("never lists another organization's endpoints", async () => {
      const mine = await create(admin);
      const result = await listWebhookEndpoints(outsider);
      expect(result.ok && result.endpoints.map((endpoint) => endpoint.id)).not.toContain(
        mine.endpoint.id,
      );
    });

    it("is for admins only", async () => {
      for (const ctx of [dispatcher, driver, api]) {
        expect(await listWebhookEndpoints(ctx)).toEqual({ ok: false, reason: "forbidden" });
      }
    });
  });

  describe("setWebhookEndpointEnabled", () => {
    it("disables with a reason and enables again, keeping the history", async () => {
      const { endpoint } = await create();
      const delivery = await insertDelivery({
        id: endpoint.id,
        organizationId: admin.organizationId,
      });

      expect(await setWebhookEndpointEnabled(admin, endpoint.id, false)).toEqual({ ok: true });
      expect(await rowOf(endpoint.id)).toMatchObject({ enabled: false, disabledReason: "manual" });

      expect(await setWebhookEndpointEnabled(admin, endpoint.id, true)).toEqual({ ok: true });
      expect(await rowOf(endpoint.id)).toMatchObject({ enabled: true, disabledReason: null });

      const [kept] = await getDb()
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.id, delivery.id));
      expect(kept).toBeDefined();
    });

    it("does not find other organizations' endpoints or malformed ids", async () => {
      const { endpoint } = await create();
      expect(await setWebhookEndpointEnabled(outsider, endpoint.id, false)).toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await setWebhookEndpointEnabled(admin, "nope", false)).toEqual({
        ok: false,
        reason: "not_found",
      });
      expect((await rowOf(endpoint.id)).enabled).toBe(true);
    });

    it("is for admins only", async () => {
      const { endpoint } = await create();
      for (const ctx of [dispatcher, driver, api]) {
        expect(await setWebhookEndpointEnabled(ctx, endpoint.id, false)).toEqual({
          ok: false,
          reason: "forbidden",
        });
      }
    });
  });

  describe("rotateWebhookSecret", () => {
    it("replaces the secret and returns the new one once", async () => {
      const { endpoint, secret } = await create();
      const result = await rotateWebhookSecret(admin, endpoint.id);
      if (!result.ok) throw new Error("rotate failed");

      expect(result.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
      expect(result.secret).not.toBe(secret);
      expect((await rowOf(endpoint.id)).secret).toBe(result.secret);
    });

    it("does not touch other organizations' endpoints, and is for admins only", async () => {
      const { endpoint, secret } = await create();
      expect(await rotateWebhookSecret(outsider, endpoint.id)).toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await rotateWebhookSecret(dispatcher, endpoint.id)).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect((await rowOf(endpoint.id)).secret).toBe(secret);
    });
  });

  describe("resendWebhookDelivery", () => {
    const base = (endpointId: string) => ({ id: endpointId, organizationId: admin.organizationId });

    it.each(["dead", "succeeded"] as const)(
      "queues a %s delivery again as a new delivery of the same event",
      async (status) => {
        const { endpoint } = await create();
        const original = await insertDelivery(base(endpoint.id), {
          status,
          attempts: 3,
          nextAttemptAt: null,
          lastStatusCode: 500,
          lastError: "Receiver answered 500",
        });
        const now = new Date("2032-01-01T00:00:00Z");

        const result = await resendWebhookDelivery(admin, original.id, now);
        if (!result.ok) throw new Error(`resend failed: ${JSON.stringify(result)}`);

        const [copy] = await getDb()
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.id, result.deliveryId));
        expect(copy!.id).not.toBe(original.id);
        expect(copy).toMatchObject({
          endpointId: endpoint.id,
          eventId: original.eventId,
          eventType: original.eventType,
          payload: original.payload,
          status: "pending",
          attempts: 0,
          nextAttemptAt: now,
          lastError: null,
        });
        // The first delivery stays as it was.
        const [kept] = await getDb()
          .select()
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.id, original.id));
        expect(kept).toMatchObject({ status, attempts: 3, lastStatusCode: 500 });
      },
    );

    it.each(["pending", "failed"] as const)(
      "refuses a delivery that is still %s",
      async (status) => {
        const { endpoint } = await create();
        const open = await insertDelivery(base(endpoint.id), { status });
        expect(await resendWebhookDelivery(admin, open.id)).toEqual({
          ok: false,
          reason: "not_finished",
        });
      },
    );

    it("refuses when the endpoint is disabled", async () => {
      const { endpoint } = await create();
      const dead = await insertDelivery(base(endpoint.id), { status: "dead", nextAttemptAt: null });
      await setWebhookEndpointEnabled(admin, endpoint.id, false);
      expect(await resendWebhookDelivery(admin, dead.id)).toEqual({
        ok: false,
        reason: "endpoint_disabled",
      });
    });

    it("does not find other organizations' deliveries or malformed ids, and is for admins only", async () => {
      const { endpoint } = await create();
      const dead = await insertDelivery(base(endpoint.id), { status: "dead", nextAttemptAt: null });
      expect(await resendWebhookDelivery(outsider, dead.id)).toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await resendWebhookDelivery(admin, "nope")).toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await resendWebhookDelivery(dispatcher, dead.id)).toEqual({
        ok: false,
        reason: "forbidden",
      });
    });
  });

  it("knows every event type the schema allows", () => {
    expect(WEBHOOK_EVENT_TYPES).toHaveLength(3);
  });
});
