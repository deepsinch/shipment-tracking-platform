import { setTimeout as sleep } from "node:timers/promises";

import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyWebhookSignature } from "@/domain/webhook-signature";
import { checkWebhookUrl } from "@/domain/webhook-url";
import { AUTO_DISABLE_AFTER_DEAD, MAX_DELIVERY_ATTEMPTS, RETRY_DELAYS_MS } from "@/domain/webhooks";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { webhookDeliveries, webhookEndpoints } from "@/server/db/schema";
import type { Resolver } from "@/server/webhooks/destination";
import type { Transport } from "@/server/webhooks/transport";

import { createTestContext, createTestOrganization } from "../../../tests/integration/fixtures";
import { TestReceiver, type Behaviour } from "../../../tests/integration/webhook-receiver";
import { insertDelivery, insertEndpoint } from "../../../tests/integration/webhooks";
import { CLAIM_LEASE_MS, drainBacklog, drainDueDeliveries } from "./webhook-delivery";
import { createWebhookEndpoint } from "./webhook-endpoints";

const LOCAL = { policy: { allowLocalTargets: true } };
const T0 = new Date("2031-05-01T12:00:00Z");
const after = (base: Date, ms: number) => new Date(base.getTime() + ms);

const deliveryOf = async (id: string) => {
  const [row] = await getDb().select().from(webhookDeliveries).where(eq(webhookDeliveries.id, id));
  return row!;
};

describe("webhook delivery", () => {
  let admin: AuthContext;
  const receivers: TestReceiver[] = [];

  beforeAll(async () => {
    admin = await createTestContext((await createTestOrganization()).id, "admin");
  });
  // A drain claims every due row in the database, so each test first parks the open rows that
  // other tests (and other files) left behind, far in the future: its counts are about its own.
  beforeEach(async () => {
    await getDb()
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date("2100-01-01T00:00:00Z") })
      .where(inArray(webhookDeliveries.status, ["pending", "failed"]));
  });
  afterEach(async () => {
    await Promise.all(receivers.splice(0).map((receiver) => receiver.stop()));
  });

  /** An endpoint pointing at a fresh local receiver, plus one delivery waiting for it. */
  async function setup(behaviour?: Behaviour) {
    const receiver = await new TestReceiver(behaviour).start();
    receivers.push(receiver);
    const endpoint = await insertEndpoint(admin.organizationId, admin.userId, {
      url: receiver.url,
    });
    const delivery = await insertDelivery(endpoint, { nextAttemptAt: T0 });
    return { receiver, endpoint, delivery };
  }

  const drain = (now: Date, limit = 50, deps = {}) =>
    drainDueDeliveries(now, limit, { ...LOCAL, ...deps });

  describe("a successful delivery", () => {
    it("posts the stored payload with a verifiable signature and the documented headers", async () => {
      const { receiver, endpoint, delivery } = await setup();

      const result = await drain(T0);

      expect(result).toMatchObject({ claimed: 1, succeeded: 1 });
      expect(receiver.requests).toHaveLength(1);
      const request = receiver.requests[0]!;
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/hook");
      expect(request.headers["content-type"]).toBe("application/json");
      expect(request.headers["waybill-event"]).toBe("shipment.status_changed");
      expect(request.headers["waybill-delivery"]).toBe(delivery.id);
      expect(JSON.parse(request.body)).toEqual(delivery.payload);

      // The receiver's side of the recipe in docs/api.md, with the endpoint's secret.
      const nowSeconds = Math.floor(T0.getTime() / 1000);
      expect(
        verifyWebhookSignature(
          endpoint.secret,
          String(request.headers["waybill-signature"]),
          request.body,
          nowSeconds,
        ),
      ).toEqual({ valid: true });
      expect(
        verifyWebhookSignature(
          "whsec_wrong",
          String(request.headers["waybill-signature"]),
          request.body,
          nowSeconds,
        ),
      ).toEqual({ valid: false, reason: "mismatch" });

      expect(await deliveryOf(delivery.id)).toMatchObject({
        status: "succeeded",
        attempts: 1,
        nextAttemptAt: null,
        lastStatusCode: 200,
        lastError: null,
        lastAttemptAt: T0,
      });
    });

    it.each([201, 204, 299])("counts %i as success", async (code) => {
      const { delivery } = await setup(() => code);
      await drain(T0);
      expect(await deliveryOf(delivery.id)).toMatchObject({
        status: "succeeded",
        lastStatusCode: code,
      });
    });
  });

  describe("failures and backoff", () => {
    it("retries after a 500 on the schedule (1 minute), then succeeds", async () => {
      const { receiver, delivery } = await setup((index) => (index === 0 ? 500 : 200));

      expect(await drain(T0)).toMatchObject({ claimed: 1, failed: 1 });
      expect(await deliveryOf(delivery.id)).toMatchObject({
        status: "failed",
        attempts: 1,
        lastStatusCode: 500,
        lastError: "Receiver answered 500",
        nextAttemptAt: after(T0, RETRY_DELAYS_MS[0]!),
      });

      // Not due yet: nothing is sent.
      expect(await drain(after(T0, 59_000))).toMatchObject({ claimed: 0 });
      expect(receiver.requests).toHaveLength(1);

      expect(await drain(after(T0, 60_000))).toMatchObject({ claimed: 1, succeeded: 1 });
      expect(receiver.requests).toHaveLength(2);
      expect(await deliveryOf(delivery.id)).toMatchObject({
        status: "succeeded",
        attempts: 2,
        lastStatusCode: 200,
        lastError: null,
        nextAttemptAt: null,
      });
      // A retry is the same delivery: same id, same event, same body.
      expect(receiver.requests[1]!.headers["waybill-delivery"]).toBe(delivery.id);
      expect(receiver.requests[1]!.body).toBe(receiver.requests[0]!.body);
    });

    it("goes dead after the last attempt, following the whole schedule", async () => {
      const { receiver, delivery } = await setup(() => 500);

      let now = T0;
      for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
        const result = await drain(now);
        expect(result.claimed).toBe(1);
        const row = await deliveryOf(delivery.id);
        expect(row.attempts).toBe(attempt);
        if (attempt < MAX_DELIVERY_ATTEMPTS) {
          expect(row).toMatchObject({
            status: "failed",
            nextAttemptAt: after(now, RETRY_DELAYS_MS[attempt - 1]!),
          });
          now = row.nextAttemptAt!;
        } else {
          expect(row).toMatchObject({ status: "dead", nextAttemptAt: null, lastStatusCode: 500 });
        }
      }

      expect(receiver.requests).toHaveLength(MAX_DELIVERY_ATTEMPTS);
      // Dead is final: later drains never touch it.
      expect(await drain(after(now, 365 * 24 * 60 * 60_000))).toMatchObject({ claimed: 0 });
      expect(receiver.requests).toHaveLength(MAX_DELIVERY_ATTEMPTS);
    });

    it("treats a receiver that never answers as a failed attempt after the deadline", async () => {
      const { delivery } = await setup(() => "hang");

      await drain(T0, 50, { timeoutMs: 150 });

      expect(await deliveryOf(delivery.id)).toMatchObject({
        status: "failed",
        lastStatusCode: null,
        lastError: "Timed out after 0.15 s",
      });
    });

    it("does not follow a redirect, even to a perfectly good receiver", async () => {
      const target = await new TestReceiver().start();
      receivers.push(target);
      const { delivery } = await setup(() => ({ redirectTo: target.url }));

      await drain(T0);

      expect(target.requests).toHaveLength(0);
      expect(await deliveryOf(delivery.id)).toMatchObject({
        status: "failed",
        lastStatusCode: 302,
        lastError: "Receiver answered 302; redirects are not followed",
      });
    });

    it("records a refused connection", async () => {
      const { receiver, delivery } = await setup();
      await receiver.stop();
      await drain(T0);
      expect(await deliveryOf(delivery.id)).toMatchObject({
        status: "failed",
        lastError: "Connection failed (ECONNREFUSED)",
      });
    });
  });

  describe("the SSRF guard at delivery time", () => {
    const resolvesTo =
      (...addresses: string[]): Resolver =>
      async () =>
        addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

    it("refuses a URL that passed save validation but now resolves to a private address", async () => {
      // The admin saves a perfectly ordinary host name...
      const saved = await createWebhookEndpoint(admin, {
        url: "https://rebind.example.com/hook",
        eventTypes: ["shipment.status_changed"],
      });
      if (!saved.ok) throw new Error(`save refused: ${JSON.stringify(saved)}`);
      expect(
        checkWebhookUrl("https://rebind.example.com/hook", { allowLocalTargets: false }).ok,
      ).toBe(true);
      const delivery = await insertDelivery(
        { id: saved.endpoint.id, organizationId: admin.organizationId },
        { nextAttemptAt: T0 },
      );

      // ...and later its DNS record points inside our network.
      const transport = vi.fn<Transport>(async () => ({ kind: "response", statusCode: 200 }));
      await drainDueDeliveries(T0, 50, {
        policy: { allowLocalTargets: false },
        resolve: resolvesTo("10.0.0.5"),
        transport,
      });

      expect(transport).not.toHaveBeenCalled();
      expect(await deliveryOf(delivery.id)).toMatchObject({
        status: "failed",
        lastStatusCode: null,
        lastError: expect.stringMatching(/^Refused: rebind\.example\.com resolves to 10\.0\.0\.5/),
      });
    });

    it.each([
      ["loopback", "127.0.0.1"],
      ["the cloud metadata address", "169.254.169.254"],
      ["IPv6 metadata", "fd00:ec2::254"],
      ["an IPv4-mapped loopback", "::ffff:127.0.0.1"],
      ["a shared address", "100.64.0.9"],
    ])("refuses a name resolving to %s", async (_label, address) => {
      const endpoint = await insertEndpoint(admin.organizationId, admin.userId, {
        url: "https://sneaky.example.com/hook",
      });
      const delivery = await insertDelivery(endpoint, { nextAttemptAt: T0 });
      const transport = vi.fn<Transport>(async () => ({ kind: "response", statusCode: 200 }));

      await drainDueDeliveries(T0, 50, {
        policy: { allowLocalTargets: false },
        resolve: resolvesTo("93.184.216.34", address),
        transport,
      });

      expect(transport).not.toHaveBeenCalled();
      expect((await deliveryOf(delivery.id)).lastError).toMatch(/^Refused:/);
    });

    it("refuses a local receiver unless the development flag is on", async () => {
      const { receiver, delivery } = await setup();

      await drainDueDeliveries(T0, 50, { policy: { allowLocalTargets: false } });

      expect(receiver.requests).toHaveLength(0);
      expect(await deliveryOf(delivery.id)).toMatchObject({
        status: "failed",
        lastError: expect.stringMatching(/^(Refused|The URL must start with https)/),
      });
    });

    it("keeps refusing a public-looking name that resolves to loopback even with the flag on", async () => {
      const receiver = await new TestReceiver().start();
      receivers.push(receiver);
      const endpoint = await insertEndpoint(admin.organizationId, admin.userId, {
        url: `http://innocent.example.com:${receiver.port}/hook`,
      });
      const delivery = await insertDelivery(endpoint, { nextAttemptAt: T0 });

      await drainDueDeliveries(T0, 50, { ...LOCAL, resolve: resolvesTo("127.0.0.1") });

      expect(receiver.requests).toHaveLength(0);
      expect((await deliveryOf(delivery.id)).status).toBe("failed");
    });

    it("connects to the vetted address even when the name resolves nowhere else", async () => {
      // The URL's host name does not exist; only the address the guard vetted can be reached.
      const receiver = await new TestReceiver().start();
      receivers.push(receiver);
      const endpoint = await insertEndpoint(admin.organizationId, admin.userId, {
        url: `http://app.localhost:${receiver.port}/hook`,
      });
      const delivery = await insertDelivery(endpoint, { nextAttemptAt: T0 });

      await drainDueDeliveries(T0, 50, { ...LOCAL, resolve: resolvesTo("127.0.0.1") });

      expect(receiver.requests).toHaveLength(1);
      expect(receiver.requests[0]!.headers.host).toBe(`app.localhost:${receiver.port}`);
      expect((await deliveryOf(delivery.id)).status).toBe("succeeded");
    });
  });

  describe("endpoints", () => {
    it("does not attempt deliveries of a disabled endpoint, and resumes when it is enabled again", async () => {
      const { receiver, endpoint, delivery } = await setup();
      await getDb()
        .update(webhookEndpoints)
        .set({ enabled: false, disabledReason: "manual" })
        .where(eq(webhookEndpoints.id, endpoint.id));

      expect(await drain(T0)).toMatchObject({ claimed: 0 });
      expect(receiver.requests).toHaveLength(0);
      expect((await deliveryOf(delivery.id)).attempts).toBe(0);

      await getDb()
        .update(webhookEndpoints)
        .set({ enabled: true, disabledReason: null })
        .where(eq(webhookEndpoints.id, endpoint.id));
      expect(await drain(T0)).toMatchObject({ claimed: 1, succeeded: 1 });
    });

    it("switches an endpoint off after repeated dead deliveries, and not before", async () => {
      const receiver = await new TestReceiver(() => 500).start();
      receivers.push(receiver);
      const endpoint = await insertEndpoint(admin.organizationId, admin.userId, {
        url: receiver.url,
      });
      // Deliveries on their last attempt: the next failure kills them.
      const lastAttempt = {
        nextAttemptAt: T0,
        status: "failed" as const,
        attempts: MAX_DELIVERY_ATTEMPTS - 1,
      };
      const rows = [];
      for (let i = 0; i < AUTO_DISABLE_AFTER_DEAD; i++)
        rows.push(await insertDelivery(endpoint, lastAttempt));

      // One short of the limit: still enabled.
      await drain(T0, AUTO_DISABLE_AFTER_DEAD - 1);
      const [still] = await getDb()
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, endpoint.id));
      expect(still).toMatchObject({ enabled: true, disabledReason: null });

      await drain(T0, 1);
      const [off] = await getDb()
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, endpoint.id));
      expect(off).toMatchObject({ enabled: false, disabledReason: "repeated_failures" });
      expect((await deliveryOf(rows[0]!.id)).status).toBe("dead");
    });

    it("does not switch an endpoint off when a success sits among the failures", async () => {
      const receiver = await new TestReceiver((index) => (index === 2 ? 200 : 500)).start();
      receivers.push(receiver);
      const endpoint = await insertEndpoint(admin.organizationId, admin.userId, {
        url: receiver.url,
      });
      const lastAttempt = {
        nextAttemptAt: T0,
        status: "failed" as const,
        attempts: MAX_DELIVERY_ATTEMPTS - 1,
      };
      for (let i = 0; i < AUTO_DISABLE_AFTER_DEAD; i++) {
        await insertDelivery(endpoint, lastAttempt);
        await drain(T0, 1);
      }
      const [row] = await getDb()
        .select()
        .from(webhookEndpoints)
        .where(eq(webhookEndpoints.id, endpoint.id));
      expect(row!.enabled).toBe(true);
    });
  });

  describe("batches", () => {
    it("claims at most `limit` rows, oldest due first", async () => {
      const receiver = await new TestReceiver().start();
      receivers.push(receiver);
      const endpoint = await insertEndpoint(admin.organizationId, admin.userId, {
        url: receiver.url,
      });
      const rows = [];
      for (let i = 0; i < 3; i++) {
        rows.push(await insertDelivery(endpoint, { nextAttemptAt: after(T0, -(3 - i) * 1000) }));
      }
      // Rows from other tests may be due too; ask for a window only these three fall into.
      const first = await drainDueDeliveries(after(T0, -1000), 2, LOCAL);
      expect(first.claimed).toBe(2);
      expect((await deliveryOf(rows[0]!.id)).status).toBe("succeeded");
      expect((await deliveryOf(rows[1]!.id)).status).toBe("succeeded");
      expect((await deliveryOf(rows[2]!.id)).status).toBe("pending");
    });

    it("drainBacklog keeps going until nothing is due", async () => {
      const receiver = await new TestReceiver().start();
      receivers.push(receiver);
      const endpoint = await insertEndpoint(admin.organizationId, admin.userId, {
        url: receiver.url,
      });
      const ids = [];
      for (let i = 0; i < 12; i++)
        ids.push((await insertDelivery(endpoint, { nextAttemptAt: T0 })).id);

      const total = await drainBacklog(5, () => T0, LOCAL);

      expect(total.succeeded).toBeGreaterThanOrEqual(12);
      for (const id of ids) expect((await deliveryOf(id)).status).toBe("succeeded");
    });
  });

  describe("two drains at once", () => {
    it("a drain that starts while another is mid-request does not send the same delivery again", async () => {
      const { receiver, delivery } = await setup();
      let release!: () => void;
      receiver.gate = new Promise<void>((resolve) => (release = resolve));

      // Drain A claims the row and is now waiting on the receiver's held response.
      const drainA = drain(T0);
      while (receiver.requests.length < 1) await sleep(10);

      // Drain B finds the row leased: nothing to claim, nothing sent.
      expect(await drain(after(T0, 1000))).toMatchObject({ claimed: 0 });
      expect(await deliveryOf(delivery.id)).toMatchObject({
        status: "pending",
        attempts: 1,
        nextAttemptAt: after(T0, CLAIM_LEASE_MS),
      });

      release();
      expect(await drainA).toMatchObject({ claimed: 1, succeeded: 1 });
      expect(receiver.requests).toHaveLength(1);
      expect((await deliveryOf(delivery.id)).attempts).toBe(1);
    });

    it("a lease that runs out (a crashed drain) lets a later drain retry the delivery", async () => {
      const { receiver, delivery } = await setup();
      // Simulate the claim of a drain that died before sending anything.
      await getDb()
        .update(webhookDeliveries)
        .set({ attempts: 1, nextAttemptAt: after(T0, CLAIM_LEASE_MS) })
        .where(eq(webhookDeliveries.id, delivery.id));

      expect(await drain(after(T0, CLAIM_LEASE_MS - 1))).toMatchObject({ claimed: 0 });
      expect(await drain(after(T0, CLAIM_LEASE_MS))).toMatchObject({ claimed: 1, succeeded: 1 });
      expect(receiver.requests).toHaveLength(1);
      expect((await deliveryOf(delivery.id)).attempts).toBe(2);
    });

    it("forced race: with the row locked by a third transaction, neither drain waits for it or sends it; after release exactly one does", async () => {
      const { receiver, delivery } = await setup();

      let releaseLock!: () => void;
      const lockReleased = new Promise<void>((resolve) => (releaseLock = resolve));
      let lockHeld!: () => void;
      const lockTaken = new Promise<void>((resolve) => (lockHeld = resolve));
      const thirdTransaction = getDb().transaction(async (tx) => {
        await tx
          .select({ id: webhookDeliveries.id })
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.id, delivery.id))
          .for("update");
        lockHeld();
        await lockReleased;
      });
      await lockTaken;

      // Both contenders run while the lock is held. SKIP LOCKED makes them pass the row by; a
      // plain FOR UPDATE would leave both blocked here until the lock is released, and then let
      // both claim it (the bug this test exists to catch), so this would time out instead.
      const contenders = Promise.all([drain(T0), drain(T0)]);
      const outcome = await Promise.race([contenders, sleep(3_000).then(() => "blocked" as const)]);
      expect(outcome).not.toBe("blocked");
      expect(outcome).toEqual([
        expect.objectContaining({ claimed: 0 }),
        expect.objectContaining({ claimed: 0 }),
      ]);
      expect(receiver.requests).toHaveLength(0);

      releaseLock();
      await thirdTransaction;

      // Released, and still contended: two drains, one winner.
      const results = await Promise.all([drain(T0), drain(T0)]);
      expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(1);
      expect(receiver.requests).toHaveLength(1);
      expect(await deliveryOf(delivery.id)).toMatchObject({ status: "succeeded", attempts: 1 });
    });

    it("many concurrent drains deliver each row exactly once", async () => {
      const receiver = await new TestReceiver().start();
      receivers.push(receiver);
      const endpoint = await insertEndpoint(admin.organizationId, admin.userId, {
        url: receiver.url,
      });
      const ids = [];
      for (let i = 0; i < 6; i++)
        ids.push((await insertDelivery(endpoint, { nextAttemptAt: T0 })).id);

      await Promise.all(Array.from({ length: 5 }, () => drain(T0, 3)));
      await drain(T0, 50);

      const delivered = receiver.requests.map((request) => request.headers["waybill-delivery"]);
      expect(new Set(delivered).size).toBe(delivered.length);
      for (const id of ids) expect(delivered.filter((seen) => seen === id)).toHaveLength(1);
    });
  });
});
