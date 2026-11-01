import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { getDb } from "@/server/db/client";
import { webhookEndpoints } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  pgErrorCode,
} from "../../../tests/integration/fixtures";
import { insertDelivery, insertEndpoint } from "../../../tests/integration/webhooks";

const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";

describe("webhook tables", () => {
  let orgId: string;
  let userId: string;
  let otherOrgId: string;
  let endpoint: Awaited<ReturnType<typeof insertEndpoint>>;

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    userId = (await createTestContext(orgId, "admin")).userId;
    otherOrgId = (await createTestOrganization("Other")).id;
    endpoint = await insertEndpoint(orgId, userId);
  });

  const code = async (promise: Promise<unknown>) => pgErrorCode(await promise.catch((e) => e));

  describe("webhook_deliveries", () => {
    it("accepts the four statuses in their valid shapes", async () => {
      await insertDelivery(endpoint, { status: "pending" });
      await insertDelivery(endpoint, { status: "failed", attempts: 1 });
      await insertDelivery(endpoint, { status: "succeeded", attempts: 1, nextAttemptAt: null });
      await insertDelivery(endpoint, { status: "dead", attempts: 6, nextAttemptAt: null });
    });

    it("rejects an unknown status", async () => {
      expect(await code(insertDelivery(endpoint, { status: "weird" as never }))).toBe(
        CHECK_VIOLATION,
      );
    });

    it("requires open deliveries to be due at some time, and finished ones to not be", async () => {
      expect(await code(insertDelivery(endpoint, { status: "pending", nextAttemptAt: null }))).toBe(
        CHECK_VIOLATION,
      );
      expect(await code(insertDelivery(endpoint, { status: "failed", nextAttemptAt: null }))).toBe(
        CHECK_VIOLATION,
      );
      expect(
        await code(insertDelivery(endpoint, { status: "succeeded", nextAttemptAt: new Date() })),
      ).toBe(CHECK_VIOLATION);
      expect(
        await code(insertDelivery(endpoint, { status: "dead", nextAttemptAt: new Date() })),
      ).toBe(CHECK_VIOLATION);
    });

    it("rejects an unknown event type and negative attempts", async () => {
      expect(await code(insertDelivery(endpoint, { eventType: "shipment.deleted" }))).toBe(
        CHECK_VIOLATION,
      );
      expect(await code(insertDelivery(endpoint, { attempts: -1 }))).toBe(CHECK_VIOLATION);
    });

    it("cannot point at another organization's endpoint (composite foreign key)", async () => {
      expect(await code(insertDelivery({ id: endpoint.id, organizationId: otherOrgId }))).toBe(
        FOREIGN_KEY_VIOLATION,
      );
    });

    it("keeps an endpoint that has deliveries (restrict)", async () => {
      await insertDelivery(endpoint);
      expect(
        await code(getDb().delete(webhookEndpoints).where(eq(webhookEndpoints.id, endpoint.id))),
      ).toBe(FOREIGN_KEY_VIOLATION);
    });

    it("has a partial index for the due-deliveries query that the planner can use", async () => {
      const { rows } = await getDb().$client.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'webhook_deliveries_due_idx'`,
      );
      expect(rows[0]!.indexdef).toMatch(/\(next_attempt_at, id\)[\s\S]*WHERE[\s\S]*pending[\s\S]*failed/);
    });
  });

  describe("webhook_endpoints", () => {
    it("ties disabled_reason to enabled", async () => {
      expect(
        await code(insertEndpoint(orgId, userId, { enabled: false, disabledReason: null })),
      ).toBe(CHECK_VIOLATION);
      expect(
        await code(insertEndpoint(orgId, userId, { enabled: true, disabledReason: "manual" })),
      ).toBe(CHECK_VIOLATION);
      expect(
        await code(insertEndpoint(orgId, userId, { enabled: false, disabledReason: "because" })),
      ).toBe(CHECK_VIOLATION);
      await insertEndpoint(orgId, userId, { enabled: false, disabledReason: "repeated_failures" });
    });

    it("rejects empty or unknown event types and an over-long URL", async () => {
      expect(await code(insertEndpoint(orgId, userId, { eventTypes: [] }))).toBe(CHECK_VIOLATION);
      expect(await code(insertEndpoint(orgId, userId, { eventTypes: ["nope"] }))).toBe(
        CHECK_VIOLATION,
      );
      expect(
        await code(insertEndpoint(orgId, userId, { url: `https://a.example/${"x".repeat(2000)}` })),
      ).toBe(CHECK_VIOLATION);
    });
  });
});
