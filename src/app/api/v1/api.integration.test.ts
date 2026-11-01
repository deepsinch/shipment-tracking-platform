import { randomInt, randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { ApiScope } from "@/domain/api-keys";
import { consumeRateLimit, RATE_LIMITS } from "@/server/auth/rate-limit";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipmentEvents, shipments } from "@/server/db/schema";
import { createApiKey, revokeApiKey } from "@/server/services/api-keys";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../../tests/integration/fixtures";
import { waitForLockWaiters } from "../../../../tests/integration/locks";
import { GET as getTracking } from "./tracking/[code]/route";
import { GET as getShipmentRoute } from "./shipments/[id]/route";
import { POST as postStatus } from "./shipments/[id]/status/route";
import { GET as listShipmentsRoute, POST as createShipmentRoute } from "./shipments/route";

/**
 * The public API, invoked as Next would: route handlers called with constructed requests, real
 * keys made by the real service, real services behind them. Error bodies are RFC 9457 documents.
 */

type Route<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;

type CallOptions<P> = {
  key?: string | null;
  method?: string;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  params?: P;
  ip?: string;
};

/** A fresh client address per call, so the per-IP limits of one test never reach another. */
const randomIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

async function call<P = Record<string, never>>(route: Route<P>, options: CallOptions<P> = {}) {
  const headers = new Headers({ "x-forwarded-for": options.ip ?? randomIp(), ...options.headers });
  if (options.key) headers.set("authorization", `Bearer ${options.key}`);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const url = new URL("http://localhost/api/v1/x");
  for (const [name, value] of Object.entries(options.query ?? {}))
    url.searchParams.set(name, value);

  const response = await route(
    new Request(url, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined
          ? undefined
          : typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body),
    }),
    { params: Promise.resolve((options.params ?? {}) as P) },
  );
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    // The parsed body, or the raw text when it is not JSON.
    body: (text ? JSON.parse(text) : null) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

const keys = (value: object) => Object.keys(value).sort();

const NEW_SHIPMENT = {
  reference: "PO-API-1",
  recipientName: "Grace Recipient",
  recipientEmail: "grace@example.test",
  originAddressLine: "Wilhelminakade 1",
  originCity: "Rotterdam",
  originCountry: "nl",
  destinationAddressLine: "Meir 1",
  destinationCity: "Antwerp",
  destinationCountry: "BE",
  weightKg: 12.5,
};

describe("public API", () => {
  let orgId: string;
  let admin: AuthContext;
  let readKey: string;
  let writeKey: string;
  let fullKey: string;
  let otherOrgFullKey: string;
  let otherOrgAdmin: AuthContext;

  async function newKey(ctx: AuthContext, scopes: ApiScope[]) {
    const result = await createApiKey(ctx, { name: "test key", scopes });
    if (!result.ok) throw new Error(JSON.stringify(result));
    return { secret: result.secret, id: result.key.id };
  }
  const shipmentIn = (organizationId: string, createdBy: string, overrides = {}) =>
    createTestShipment(organizationId, createdBy, overrides);

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    admin = await createTestContext(orgId, "admin");
    readKey = (await newKey(admin, ["shipments:read"])).secret;
    writeKey = (await newKey(admin, ["shipments:write"])).secret;
    fullKey = (await newKey(admin, ["shipments:read", "shipments:write"])).secret;

    const otherOrg = await createTestOrganization("Other Freight");
    otherOrgAdmin = await createTestContext(otherOrg.id, "admin");
    otherOrgFullKey = (await newKey(otherOrgAdmin, ["shipments:read", "shipments:write"])).secret;
  });

  describe("authentication", () => {
    it("lets a key list shipments until it is revoked, then answers 401", async () => {
      const { secret, id } = await newKey(admin, ["shipments:read"]);
      expect((await call(listShipmentsRoute, { key: secret })).status).toBe(200);

      await revokeApiKey(admin, id);
      const response = await call(listShipmentsRoute, { key: secret });

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toBe("application/problem+json");
      expect(response.headers.get("www-authenticate")).toBe('Bearer realm="waybill-api"');
      expect(response.body).toMatchObject({
        type: "urn:waybill:problem:unauthorized",
        status: 401,
      });
    });

    it("answers 401 for a missing, malformed or unknown key, all the same", async () => {
      const unknown = `wb_live_${"A".repeat(43)}`;
      const bodies = [];
      for (const key of [null, "garbage", unknown]) {
        const response = await call(listShipmentsRoute, { key });
        expect(response.status).toBe(401);
        bodies.push(response.body);
      }
      expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1);
    });

    it("rejects a non-Bearer Authorization header", async () => {
      const response = await call(listShipmentsRoute, {
        headers: { authorization: `Basic ${fullKey}` },
      });
      expect(response.status).toBe(401);
    });
  });

  describe("scopes", () => {
    it("answers 403 when the key lacks the scope, for every operation", async () => {
      const shipment = await shipmentIn(orgId, admin.userId);
      const params = { id: shipment.id };

      const writeOnly = [
        await call(listShipmentsRoute, { key: writeKey }),
        await call(getShipmentRoute, { key: writeKey, params }),
      ];
      const readOnly = [
        await call(createShipmentRoute, { key: readKey, method: "POST", body: NEW_SHIPMENT }),
        await call(postStatus, {
          key: readKey,
          method: "POST",
          params,
          headers: { "if-match": '"1"' },
          body: { status: "picked_up" },
        }),
      ];

      for (const response of [...writeOnly, ...readOnly]) {
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ type: "urn:waybill:problem:forbidden" });
      }
      expect(writeOnly[0]!.body.detail).toContain("shipments:read");
      expect(readOnly[0]!.body.detail).toContain("shipments:write");
      // Nothing happened.
      const [row] = await getDb().select().from(shipments).where(eq(shipments.id, shipment.id));
      expect(row).toMatchObject({ status: "created", version: 1 });
    });
  });

  describe("organization isolation", () => {
    it("never shows, reads or changes another organization's shipments", async () => {
      const theirs = await shipmentIn(otherOrgAdmin.organizationId, otherOrgAdmin.userId, {
        reference: "THEIRS-ONLY",
      });
      const params = { id: theirs.id };

      const list = await call(listShipmentsRoute, {
        key: fullKey,
        query: { search: "THEIRS-ONLY" },
      });
      expect(list.body.data).toEqual([]);

      const get = await call(getShipmentRoute, { key: fullKey, params });
      expect(get.status).toBe(404);

      const change = await call(postStatus, {
        key: fullKey,
        method: "POST",
        params,
        headers: { "if-match": '"1"' },
        body: { status: "picked_up" },
      });
      expect(change.status).toBe(404);

      // The owner still sees it, untouched.
      const owner = await call(getShipmentRoute, { key: otherOrgFullKey, params });
      expect(owner.status).toBe(200);
      expect(owner.body.status).toBe("created");
    });

    it("books shipments into the key's own organization", async () => {
      const created = await call(createShipmentRoute, {
        key: otherOrgFullKey,
        method: "POST",
        body: NEW_SHIPMENT,
      });
      expect(created.status).toBe(201);
      const [row] = await getDb().select().from(shipments).where(eq(shipments.id, created.body.id));
      expect(row!.organizationId).toBe(otherOrgAdmin.organizationId);
    });
  });

  describe("GET /shipments", () => {
    it("paginates, filters and searches, newest first, with an explicit set of keys", async () => {
      const org = (await createTestOrganization("Lister")).id;
      const owner = await createTestContext(org, "admin");
      const key = (await newKey(owner, ["shipments:read"])).secret;
      const base = Date.parse("2026-01-01T00:00:00Z");
      for (let i = 0; i < 3; i++) {
        await shipmentIn(org, owner.userId, {
          reference: `REF-${i}`,
          status: i === 1 ? "in_transit" : "created",
          createdAt: new Date(base + i * 60_000),
        });
      }

      const page1 = await call(listShipmentsRoute, { key, query: { pageSize: "2" } });
      expect(page1.status).toBe(200);
      expect(page1.body.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
      expect(page1.body.data.map((s: { reference: string }) => s.reference)).toEqual([
        "REF-2",
        "REF-1",
      ]);
      expect(keys(page1.body)).toEqual(["data", "pagination"]);
      expect(keys(page1.body.data[0])).toEqual([
        "createdAt",
        "destination",
        "id",
        "origin",
        "promisedDeliveryAt",
        "recipientName",
        "reference",
        "serviceLevel",
        "status",
        "trackingCode",
      ]);
      expect(keys(page1.body.data[0].origin)).toEqual(["city", "country"]);
      expect(page1.body.data[0].createdAt).toBe("2026-01-01T00:02:00.000Z");

      const page2 = await call(listShipmentsRoute, { key, query: { pageSize: "2", page: "2" } });
      expect(page2.body.data.map((s: { reference: string }) => s.reference)).toEqual(["REF-0"]);

      const filtered = await call(listShipmentsRoute, { key, query: { status: "in_transit" } });
      expect(filtered.body.data.map((s: { reference: string }) => s.reference)).toEqual(["REF-1"]);

      const found = await call(listShipmentsRoute, { key, query: { search: "ref-0" } });
      expect(found.body.data).toHaveLength(1);
    });

    it("answers 400 with field errors for a bad query", async () => {
      const response = await call(listShipmentsRoute, {
        key: readKey,
        query: { page: "0", status: "flying" },
      });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ type: "urn:waybill:problem:validation", status: 400 });
      expect(Object.keys(response.body.errors).sort()).toEqual(["page", "status"]);
    });
  });

  describe("GET /shipments/{id}", () => {
    it("returns the shipment with its history, an ETag and an explicit set of keys", async () => {
      const shipment = await shipmentIn(orgId, admin.userId, { reference: "DETAIL" });
      const response = await call(getShipmentRoute, { key: readKey, params: { id: shipment.id } });

      expect(response.status).toBe(200);
      expect(response.headers.get("etag")).toBe('"1"');
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(keys(response.body)).toEqual([
        "createdAt",
        "destination",
        "driverName",
        "events",
        "id",
        "origin",
        "promisedDeliveryAt",
        "recipient",
        "reference",
        "serviceLevel",
        "status",
        "trackingCode",
        "updatedAt",
        "weightKg",
      ]);
      expect(keys(response.body.origin)).toEqual([
        "addressLine",
        "city",
        "country",
        "lat",
        "lng",
        "postalCode",
      ]);
      expect(keys(response.body.recipient)).toEqual(["email", "name"]);
      expect(response.body.events).toHaveLength(1);
      expect(keys(response.body.events[0])).toEqual([
        "assignment",
        "fromStatus",
        "internalNote",
        "location",
        "occurredAt",
        "publicNote",
        "recordedAt",
        "toStatus",
        "type",
      ]);
      // No internal ids anywhere in the document.
      const text = JSON.stringify(response.body);
      for (const id of [orgId, admin.userId]) expect(text).not.toContain(id);
    });

    it("answers 404 for unknown and malformed ids", async () => {
      for (const id of [randomUUID(), "not-a-uuid"]) {
        const response = await call(getShipmentRoute, { key: readKey, params: { id } });
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ type: "urn:waybill:problem:not-found" });
      }
    });
  });

  describe("POST /shipments", () => {
    it("books a shipment: 201, Location, ETag, and the history event", async () => {
      const response = await call(createShipmentRoute, {
        key: writeKey,
        method: "POST",
        body: NEW_SHIPMENT,
      });

      expect(response.status).toBe(201);
      expect(response.headers.get("etag")).toBe('"1"');
      expect(response.headers.get("location")).toBe(`/api/v1/shipments/${response.body.id}`);
      expect(keys(response.body)).toEqual([
        "createdAt",
        "destination",
        "id",
        "origin",
        "promisedDeliveryAt",
        "recipient",
        "reference",
        "serviceLevel",
        "status",
        "trackingCode",
        "updatedAt",
        "weightKg",
      ]);
      expect(response.body).toMatchObject({ status: "created", origin: { country: "NL" } });
      const events = await getDb()
        .select()
        .from(shipmentEvents)
        .where(eq(shipmentEvents.shipmentId, response.body.id));
      expect(events.map((event) => event.type)).toEqual(["created"]);
    });

    it("answers 400 with field errors, translated to the API's field names", async () => {
      const response = await call(createShipmentRoute, {
        key: writeKey,
        method: "POST",
        body: { ...NEW_SHIPMENT, recipientName: "", weightKg: -1, originCountry: "Netherlands" },
      });

      expect(response.status).toBe(400);
      expect(Object.keys(response.body.errors).sort()).toEqual([
        "originCountry",
        "recipientName",
        "weightKg",
      ]);
    });

    it("rejects unknown fields, including assignedDriverId, and creates nothing", async () => {
      const before = await countShipments(orgId);
      const response = await call(createShipmentRoute, {
        key: writeKey,
        method: "POST",
        body: { ...NEW_SHIPMENT, assignedDriverId: admin.userId, weigthKg: 3 },
      });

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual({
        assignedDriverId: ["Unknown field"],
        weigthKg: ["Unknown field"],
      });
      expect(await countShipments(orgId)).toBe(before);
    });

    it("answers 400 for a body that is not a JSON object", async () => {
      const invalid = await call(createShipmentRoute, {
        key: writeKey,
        method: "POST",
        body: "{not json",
      });
      expect(invalid.status).toBe(400);
      expect(invalid.body.type).toBe("urn:waybill:problem:invalid-json");

      const array = await call(createShipmentRoute, { key: writeKey, method: "POST", body: [] });
      expect(array.status).toBe(400);
      expect(array.body.type).toBe("urn:waybill:problem:validation");
    });
  });

  describe("POST /shipments/{id}/status", () => {
    const change = (
      key: string,
      id: string,
      ifMatch: string | null,
      body: unknown = { status: "picked_up" },
    ) =>
      call(postStatus, {
        key,
        method: "POST",
        params: { id },
        headers: ifMatch === null ? {} : { "if-match": ifMatch },
        body,
      });

    it("requires If-Match: 428 without it, and nothing changes", async () => {
      const shipment = await shipmentIn(orgId, admin.userId);
      const response = await change(fullKey, shipment.id, null);

      expect(response.status).toBe(428);
      expect(response.body).toMatchObject({ type: "urn:waybill:problem:precondition-required" });
      const [row] = await getDb().select().from(shipments).where(eq(shipments.id, shipment.id));
      expect(row).toMatchObject({ status: "created", version: 1 });
    });

    it("answers 400 for an If-Match that is not an ETag", async () => {
      const shipment = await shipmentIn(orgId, admin.userId);
      for (const header of ["1", "*", 'W/"1"']) {
        const response = await change(fullKey, shipment.id, header);
        expect(response.status).toBe(400);
        expect(response.body.errors).toHaveProperty(["If-Match"]);
      }
    });

    it("changes the status and bumps the ETag; a stale ETag then gets 412 with the current one", async () => {
      const shipment = await shipmentIn(orgId, admin.userId);

      const ok = await change(fullKey, shipment.id, '"1"', {
        status: "picked_up",
        publicNote: "Collected",
        internalNote: "Dock 4",
        location: { city: "Rotterdam", lat: 51.9, lng: 4.5 },
      });
      expect(ok.status).toBe(200);
      expect(ok.headers.get("etag")).toBe('"2"');
      expect(ok.body.status).toBe("picked_up");
      expect(keys(ok.body)).not.toContain("events");

      const stale = await change(fullKey, shipment.id, '"1"', { status: "in_transit" });
      expect(stale.status).toBe(412);
      expect(stale.headers.get("etag")).toBe('"2"');
      expect(stale.body).toMatchObject({ type: "urn:waybill:problem:precondition-failed" });

      // Re-reading gives the same ETag the 412 advertised, and retrying with it works.
      const read = await call(getShipmentRoute, { key: fullKey, params: { id: shipment.id } });
      expect(read.headers.get("etag")).toBe('"2"');
      expect(read.body.events.map((e: { type: string }) => e.type)).toEqual([
        "created",
        "status_changed",
      ]);
      const retry = await change(fullKey, shipment.id, read.headers.get("etag"), {
        status: "in_transit",
      });
      expect(retry.status).toBe(200);
      expect(retry.headers.get("etag")).toBe('"3"');
    });

    it("answers 409 for a transition the state machine forbids", async () => {
      const shipment = await shipmentIn(orgId, admin.userId);
      const response = await change(fullKey, shipment.id, '"1"', { status: "delivered" });

      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        type: "urn:waybill:problem:invalid-transition",
        from: "created",
        to: "delivered",
      });
    });

    it("answers 400 naming the API's field `status`, and 404 for unknown shipments", async () => {
      const shipment = await shipmentIn(orgId, admin.userId);

      const missing = await change(fullKey, shipment.id, '"1"', {});
      expect(missing.status).toBe(400);
      expect(missing.body.errors).toHaveProperty("status");
      expect(missing.body.errors).not.toHaveProperty("toStatus");

      const unknownField = await change(fullKey, shipment.id, '"1"', {
        status: "exception",
        expectedVersion: 9,
      });
      expect(unknownField.status).toBe(400);
      expect(unknownField.body.errors).toEqual({ expectedVersion: ["Unknown field"] });

      const unknown = await change(fullKey, randomUUID(), '"1"');
      expect(unknown.status).toBe(404);
    });

    describe("concurrency", () => {
      it("lets exactly one of two simultaneous requests with the same If-Match win", async () => {
        const shipment = await shipmentIn(orgId, admin.userId);
        // Two keys, so the two requests do not queue on one rate-limit counter: the only lock the
        // contenders wait on is the shipment row held below.
        const keyA = (await newKey(admin, ["shipments:write"])).secret;
        const keyB = (await newKey(admin, ["shipments:write"])).secret;

        // A third transaction holds the row lock. Both requests read version 1, pass the If-Match
        // pre-check and the state machine, then queue on the guarded UPDATE. Only when both are
        // blocked is the lock released, so they really run at the same moment.
        let pending: Promise<Awaited<ReturnType<typeof change>>[]> | undefined;
        await getDb().transaction(async (tx) => {
          await tx.execute(sql`SELECT 1 FROM shipments WHERE id = ${shipment.id} FOR UPDATE`);
          pending = Promise.all([
            change(keyA, shipment.id, '"1"', { status: "picked_up" }),
            change(keyB, shipment.id, '"1"', { status: "exception" }),
          ]);
          await waitForLockWaiters(2);
        });
        const responses = await pending!;

        expect(responses.map((response) => response.status).sort()).toEqual([200, 412]);
        const winner = responses.find((response) => response.status === 200)!;
        const loser = responses.find((response) => response.status === 412)!;
        expect(winner.headers.get("etag")).toBe('"2"');
        expect(loser.headers.get("etag")).toBe('"2"');

        const [row] = await getDb().select().from(shipments).where(eq(shipments.id, shipment.id));
        expect(row).toMatchObject({ status: winner.body.status, version: 2 });
        const statusEvents = (
          await getDb()
            .select()
            .from(shipmentEvents)
            .where(eq(shipmentEvents.shipmentId, shipment.id))
        ).filter((event) => event.type === "status_changed");
        expect(statusEvents).toHaveLength(1);
      });
    });
  });

  describe("GET /tracking/{code}", () => {
    it("is public: no key, only the public projection", async () => {
      const shipment = await shipmentIn(orgId, admin.userId, { recipientName: "Secret Person" });
      await change(shipment.id, '"1"', {
        status: "picked_up",
        publicNote: "Collected",
        internalNote: "gate code 4411",
        location: { city: "Rotterdam", lat: 51.9, lng: 4.5 },
      });

      const response = await call(getTracking, {
        params: { code: shipment.trackingCode.toLowerCase().replaceAll("-", "") },
      });

      expect(response.status).toBe(200);
      expect(keys(response.body)).toEqual([
        "destination",
        "origin",
        "promisedDeliveryAt",
        "signedBy",
        "status",
        "timeline",
        "trackingCode",
      ]);
      expect(keys(response.body.timeline[0])).toEqual([
        "city",
        "occurredAt",
        "publicNote",
        "status",
        "type",
      ]);
      expect(response.body.timeline.map((e: { status: string }) => e.status)).toEqual([
        "created",
        "picked_up",
      ]);
      const text = JSON.stringify(response.body);
      for (const secret of [
        "Secret Person",
        "gate code 4411",
        "1 Origin Street",
        orgId,
        shipment.id,
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(text).not.toContain("51.9");
    });

    it("answers 404 for unknown and malformed codes", async () => {
      for (const code of ["WB-AAAA-AAAA", "nonsense"]) {
        const response = await call(getTracking, { params: { code } });
        expect(response.status).toBe(404);
      }
    });

    async function change(id: string, ifMatch: string, body: unknown) {
      return call(postStatus, {
        key: fullKey,
        method: "POST",
        params: { id },
        headers: { "if-match": ifMatch },
        body,
      });
    }
  });

  describe("rate limits", () => {
    it("answers 429 with Retry-After once a key is over its limit, and not other keys", async () => {
      const limited = await newKey(admin, ["shipments:read"]);
      for (let i = 0; i < RATE_LIMITS.apiPerKey.limit; i++) {
        await consumeRateLimit(RATE_LIMITS.apiPerKey, limited.id);
      }

      const response = await call(listShipmentsRoute, { key: limited.secret });
      expect(response.status).toBe(429);
      expect(response.body).toMatchObject({ type: "urn:waybill:problem:rate-limited" });
      const retryAfter = Number(response.headers.get("retry-after"));
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(60);

      expect((await call(listShipmentsRoute, { key: readKey })).status).toBe(200);
    });

    it("limits requests with invalid keys per client address", async () => {
      const ip = randomIp();
      for (let i = 0; i < RATE_LIMITS.apiInvalidKeyPerIp.limit; i++) {
        expect((await call(listShipmentsRoute, { key: "wrong", ip })).status).toBe(401);
      }

      const blocked = await call(listShipmentsRoute, { key: "wrong", ip });
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).not.toBeNull();
      // A valid key from the same address is unaffected: only failures are counted.
      expect((await call(listShipmentsRoute, { key: readKey, ip })).status).toBe(200);
    });

    it("limits public tracking lookups per client address", async () => {
      const ip = randomIp();
      for (let i = 0; i < RATE_LIMITS.apiTrackingPerIp.limit; i++) {
        await consumeRateLimit(RATE_LIMITS.apiTrackingPerIp, ip);
      }
      const response = await call(getTracking, { params: { code: "WB-AAAA-AAAA" }, ip });
      expect(response.status).toBe(429);
    });
  });
});

async function countShipments(organizationId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(shipments)
    .where(eq(shipments.organizationId, organizationId));
  return row!.count;
}
