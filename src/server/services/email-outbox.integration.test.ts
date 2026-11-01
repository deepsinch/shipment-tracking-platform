import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { EMAIL_NOTIFY_STATUSES } from "@/domain/email";
import { SHIPMENT_STATUSES, type ShipmentStatus } from "@/domain/shipment-status";
import { deriveUnsubscribeKey, verifyUnsubscribeToken } from "@/domain/unsubscribe-token";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { emailMessages, emailOptOuts } from "@/server/db/schema";
import { env } from "@/server/env";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { changeShipmentStatus } from "./change-shipment-status";
import { enqueueStatusEmail } from "./email-outbox";

const messagesOf = (shipmentId: string) =>
  getDb().select().from(emailMessages).where(eq(emailMessages.shipmentId, shipmentId));

describe("email outbox", () => {
  let admin: AuthContext;
  let orgId: string;

  beforeAll(async () => {
    orgId = (await createTestOrganization("Acme Freight")).id;
    admin = await createTestContext(orgId, "admin");
  });

  const shipmentWithEmail = (email: string | null = `ada-${crypto.randomUUID()}@Example.com`) =>
    createTestShipment(orgId, admin.userId, { recipientEmail: email });

  it("queues one rendered email when a shipment reaches a notifiable status", async () => {
    const shipment = await shipmentWithEmail("Ada@Example.com");

    const result = await changeShipmentStatus(admin, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "picked_up",
      publicNote: "Collected from the warehouse",
    });
    if (!result.ok) throw new Error("status failed");

    const [message, ...rest] = await messagesOf(shipment.id);
    expect(rest).toEqual([]);
    expect(message).toMatchObject({
      organizationId: orgId,
      recipient: "ada@example.com",
      status: "pending",
      attempts: 0,
      transport: null,
      lastError: null,
      idempotencyKey: `waybill-status-email/${result.event.id}`,
    });
    expect(message!.nextAttemptAt).toBeInstanceOf(Date);
    expect(message!.subject).toContain(shipment.trackingCode);
    for (const body of [message!.textBody, message!.htmlBody]) {
      expect(body).toContain("Picked up");
      expect(body).toContain("Acme Freight");
      expect(body).toContain("Collected from the warehouse");
      // Absolute public tracking link on this deployment's origin.
      expect(body).toContain(`${env.auth.url}/track/${shipment.trackingCode}`);
    }
  });

  it("links an unsubscribe URL whose token names this organization and address", async () => {
    const shipment = await shipmentWithEmail("Grace@Example.com");
    await changeShipmentStatus(admin, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "picked_up",
    });

    const [message] = await messagesOf(shipment.id);
    const token = /\/unsubscribe\/([A-Za-z0-9_.-]+)/.exec(message!.textBody)?.[1];
    expect(token).toBeDefined();
    expect(verifyUnsubscribeToken(deriveUnsubscribeKey(env.auth.secret), token!)).toEqual({
      organizationId: orgId,
      email: "grace@example.com",
    });
  });

  it("never puts the internal note in the stored message", async () => {
    const shipment = await shipmentWithEmail();
    await changeShipmentStatus(admin, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "picked_up",
      publicNote: "Collected",
      internalNote: "Gate code 4711, customer is difficult",
    });

    const [message] = await messagesOf(shipment.id);
    const everything = [message!.subject, message!.textBody, message!.htmlBody].join("\n");
    expect(everything).toContain("Collected");
    expect(everything).not.toContain("Gate code");
    expect(everything).not.toContain("4711");
    expect(everything).not.toContain("difficult");
  });

  it("queues for exactly the notifiable statuses, whatever the route to them", async () => {
    const queued: ShipmentStatus[] = [];
    for (const status of SHIPMENT_STATUSES) {
      const shipment = await shipmentWithEmail();
      const event = { id: crypto.randomUUID(), publicNote: null };
      await getDb().transaction((tx) => enqueueStatusEmail(tx, { ...shipment, status }, event));
      if ((await messagesOf(shipment.id)).length === 1) queued.push(status);
    }
    expect(queued.sort()).toEqual([...EMAIL_NOTIFY_STATUSES].sort());
  });

  it("queues nothing for a shipment without a recipient email", async () => {
    const shipment = await shipmentWithEmail(null);
    await changeShipmentStatus(admin, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "picked_up",
    });
    expect(await messagesOf(shipment.id)).toEqual([]);
  });

  it("queues nothing for a status customers are not told about", async () => {
    const shipment = await shipmentWithEmail();
    await changeShipmentStatus(admin, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "cancelled",
    });
    expect(await messagesOf(shipment.id)).toEqual([]);
  });

  it("queues nothing for a change that did not happen", async () => {
    const shipment = await shipmentWithEmail();
    const stale = await changeShipmentStatus(admin, {
      shipmentId: shipment.id,
      expectedVersion: 9,
      toStatus: "picked_up",
    });
    const invalid = await changeShipmentStatus(admin, {
      shipmentId: shipment.id,
      expectedVersion: 1,
      toStatus: "delivered",
    });
    expect(stale).toMatchObject({ ok: false, reason: "conflict" });
    expect(invalid).toMatchObject({ ok: false, reason: "invalid_transition" });
    expect(await messagesOf(shipment.id)).toEqual([]);
  });

  it("leaves no email behind when the transaction rolls back", async () => {
    const shipment = await shipmentWithEmail();
    const event = { id: crypto.randomUUID(), publicNote: null };

    await expect(
      getDb().transaction(async (tx) => {
        await enqueueStatusEmail(tx, { ...shipment, status: "delivered" }, event);
        expect(
          await tx.select().from(emailMessages).where(eq(emailMessages.shipmentId, shipment.id)),
        ).toHaveLength(1);
        throw new Error("the change failed after queueing");
      }),
    ).rejects.toThrow("the change failed");

    expect(await messagesOf(shipment.id)).toEqual([]);
  });

  it("queues nothing for an address that opted out of this organization, but does for others", async () => {
    const email = `optout-${crypto.randomUUID()}@example.com`;
    await getDb().insert(emailOptOuts).values({ organizationId: orgId, email });

    const mine = await shipmentWithEmail(email);
    await changeShipmentStatus(admin, {
      shipmentId: mine.id,
      expectedVersion: 1,
      toStatus: "picked_up",
    });
    expect(await messagesOf(mine.id)).toEqual([]);

    // The same address is a customer of another carrier, who has no opt-out.
    const otherOrg = await createTestOrganization("Other Carrier");
    const other = await createTestContext(otherOrg.id, "admin");
    const theirs = await createTestShipment(otherOrg.id, other.userId, { recipientEmail: email });
    await changeShipmentStatus(other, {
      shipmentId: theirs.id,
      expectedVersion: 1,
      toStatus: "picked_up",
    });
    expect(await messagesOf(theirs.id)).toHaveLength(1);
  });

  it("sends one email per event: queueing the same event twice keeps the first", async () => {
    const shipment = await shipmentWithEmail();
    const event = { id: crypto.randomUUID(), publicNote: null };
    await getDb().transaction(async (tx) => {
      await enqueueStatusEmail(tx, { ...shipment, status: "delivered" }, event);
      await enqueueStatusEmail(tx, { ...shipment, status: "delivered" }, event);
    });
    expect(await messagesOf(shipment.id)).toHaveLength(1);
  });
});
