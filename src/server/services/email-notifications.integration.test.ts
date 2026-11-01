import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { deriveUnsubscribeKey, signUnsubscribeToken } from "@/domain/unsubscribe-token";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { emailMessages, emailOptOuts } from "@/server/db/schema";
import { previewTransport } from "@/server/email/transports";
import { env } from "@/server/env";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { changeShipmentStatus } from "./change-shipment-status";
import { drainDueEmails } from "./email-delivery";
import {
  describeUnsubscribeToken,
  getShipmentEmailStatus,
  listEmailPreviews,
  maskEmail,
  unsubscribeWithToken,
} from "./email-notifications";

const tokenFor = (organizationId: string, email: string) =>
  signUnsubscribeToken(deriveUnsubscribeKey(env.auth.secret), { organizationId, email });

describe("email notifications", () => {
  let admin: AuthContext;
  let dispatcher: AuthContext;
  let driver: AuthContext;
  let outsider: AuthContext;

  beforeAll(async () => {
    const org = await createTestOrganization("Notifier Ltd");
    admin = await createTestContext(org.id, "admin");
    dispatcher = await createTestContext(org.id, "dispatcher");
    driver = await createTestContext(org.id, "driver");
    outsider = await createTestContext((await createTestOrganization("Other")).id, "admin");
  });

  async function shipmentWithEmail(email = `c-${crypto.randomUUID()}@example.com`) {
    return createTestShipment(admin.organizationId, admin.userId, { recipientEmail: email });
  }

  describe("getShipmentEmailStatus", () => {
    it("shows queued, then preview once the preview transport took it", async () => {
      const shipment = await shipmentWithEmail("Status@Example.com");
      await changeShipmentStatus(admin, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "picked_up",
      });

      const queued = await getShipmentEmailStatus(dispatcher, shipment.id);
      expect(queued).toMatchObject({ ok: true, recipient: "status@example.com", optedOut: false });
      expect(queued.ok && queued.messages.map((m) => m.status)).toEqual(["queued"]);

      await drainDueEmails(new Date(Date.now() + 60_000), 50, { transport: previewTransport });
      const sent = await getShipmentEmailStatus(dispatcher, shipment.id);
      expect(sent.ok && sent.messages.map((m) => m.status)).toEqual(["preview"]);
    });

    it("never returns message content, only status, time and error", async () => {
      const shipment = await shipmentWithEmail();
      await changeShipmentStatus(admin, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "picked_up",
      });
      const result = await getShipmentEmailStatus(admin, shipment.id);
      expect(result.ok && Object.keys(result.messages[0]!).sort()).toEqual([
        "createdAt",
        "id",
        "lastError",
        "status",
      ]);
    });

    it("reports an opted-out recipient and a shipment without an address", async () => {
      const email = `out-${crypto.randomUUID()}@example.com`;
      await getDb().insert(emailOptOuts).values({ organizationId: admin.organizationId, email });
      const optedOut = await getShipmentEmailStatus(admin, (await shipmentWithEmail(email)).id);
      expect(optedOut).toMatchObject({ ok: true, optedOut: true });

      const none = await createTestShipment(admin.organizationId, admin.userId, {
        recipientEmail: null,
      });
      expect(await getShipmentEmailStatus(admin, none.id)).toMatchObject({
        ok: true,
        recipient: null,
        optedOut: false,
        messages: [],
      });
    });

    it("is for admins and dispatchers, and does not find other organizations' shipments", async () => {
      const shipment = await shipmentWithEmail();
      expect(await getShipmentEmailStatus(driver, shipment.id)).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect(await getShipmentEmailStatus({ ...admin, role: "api" }, shipment.id)).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect(await getShipmentEmailStatus(outsider, shipment.id)).toEqual({
        ok: false,
        reason: "not_found",
      });
      expect(await getShipmentEmailStatus(admin, "nope")).toEqual({
        ok: false,
        reason: "not_found",
      });
    });
  });

  describe("listEmailPreviews", () => {
    it("lists preview messages for admins, newest first, with the text version", async () => {
      const shipment = await shipmentWithEmail();
      await changeShipmentStatus(admin, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "picked_up",
        publicNote: "Collected",
        internalNote: "Gate code 1234",
      });
      await drainDueEmails(new Date(Date.now() + 60_000), 50, { transport: previewTransport });

      const result = await listEmailPreviews(admin);
      if (!result.ok) throw new Error("forbidden");
      const mine = result.previews.find((p) => p.shipmentId === shipment.id);
      expect(mine).toMatchObject({
        recipient: shipment.recipientEmail,
        trackingCode: shipment.trackingCode,
      });
      expect(mine!.textBody).toContain("Collected");
      expect(mine!.textBody).not.toContain("Gate code");
      expect(Object.keys(mine!).sort()).toEqual([
        "createdAt",
        "id",
        "recipient",
        "shipmentId",
        "subject",
        "textBody",
        "trackingCode",
      ]);
    });

    it("leaves out messages that are still queued, and other organizations' messages", async () => {
      const shipment = await shipmentWithEmail();
      await changeShipmentStatus(admin, {
        shipmentId: shipment.id,
        expectedVersion: 1,
        toStatus: "picked_up",
      });
      const queuedOnly = await listEmailPreviews(admin);
      expect(queuedOnly.ok && queuedOnly.previews.some((p) => p.shipmentId === shipment.id)).toBe(
        false,
      );

      await drainDueEmails(new Date(Date.now() + 60_000), 50, { transport: previewTransport });
      const theirs = await listEmailPreviews(outsider);
      expect(theirs.ok && theirs.previews.some((p) => p.shipmentId === shipment.id)).toBe(false);
    });

    it("is for admins only", async () => {
      for (const ctx of [dispatcher, driver, { ...admin, role: "api" as const }]) {
        expect(await listEmailPreviews(ctx)).toEqual({ ok: false, reason: "forbidden" });
      }
    });
  });

  describe("unsubscribing", () => {
    it("describes a genuine token without revealing the address", async () => {
      const target = await describeUnsubscribeToken(
        tokenFor(admin.organizationId, "ada@example.com"),
      );
      expect(target).toEqual({
        organizationName: "Notifier Ltd",
        maskedEmail: "a***@example.com",
        optedOut: false,
      });
    });

    it("opts the address out of this organization's emails, idempotently, and stops the next one", async () => {
      const email = `leave-${crypto.randomUUID()}@example.com`;
      const first = await shipmentWithEmail(email);
      const token = tokenFor(admin.organizationId, email);

      expect(await unsubscribeWithToken(token)).toMatchObject({
        ok: true,
        target: { optedOut: true },
      });
      expect(await unsubscribeWithToken(token)).toMatchObject({ ok: true });
      expect(
        await getDb().select().from(emailOptOuts).where(eq(emailOptOuts.email, email)),
      ).toHaveLength(1);

      // The next status change, on this shipment or a future one, sends nothing.
      await changeShipmentStatus(admin, {
        shipmentId: first.id,
        expectedVersion: 1,
        toStatus: "picked_up",
      });
      const later = await shipmentWithEmail(email);
      await changeShipmentStatus(admin, {
        shipmentId: later.id,
        expectedVersion: 1,
        toStatus: "picked_up",
      });
      for (const id of [first.id, later.id]) {
        expect(
          await getDb().select().from(emailMessages).where(eq(emailMessages.shipmentId, id)),
        ).toEqual([]);
      }
    });

    it("rejects a tampered or foreign token and records nothing", async () => {
      const email = `safe-${crypto.randomUUID()}@example.com`;
      const token = tokenFor(admin.organizationId, email);
      const [payload, signature] = token.split(".");
      const forged = `${Buffer.from(JSON.stringify({ o: admin.organizationId, e: `victim-${email}` })).toString("base64url")}.${signature}`;
      const foreign = signUnsubscribeToken(
        deriveUnsubscribeKey("another-secret-0123456789abcdefghijkl"),
        {
          organizationId: admin.organizationId,
          email,
        },
      );

      for (const bad of [forged, foreign, `${payload}.AAAA`, "garbage", ""]) {
        expect(await unsubscribeWithToken(bad)).toEqual({ ok: false, reason: "invalid_token" });
        expect(await describeUnsubscribeToken(bad)).toBeNull();
      }
      const stored = await getDb().select().from(emailOptOuts);
      expect(stored.some((row) => row.email.includes(email))).toBe(false);
    });

    it("opts out only the organization the token names", async () => {
      const email = `scope-${crypto.randomUUID()}@example.com`;
      await unsubscribeWithToken(tokenFor(admin.organizationId, email));
      const other = await describeUnsubscribeToken(tokenFor(outsider.organizationId, email));
      expect(other?.optedOut).toBe(false);
    });
  });

  it("masks addresses", () => {
    expect(maskEmail("ada@example.com")).toBe("a***@example.com");
    expect(maskEmail("@example.com")).toBe("***");
    expect(maskEmail("nonsense")).toBe("***");
  });
});
