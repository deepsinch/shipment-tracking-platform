import { setTimeout as sleep } from "node:timers/promises";

import { eq, inArray } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MAX_DELIVERY_ATTEMPTS, RETRY_DELAYS_MS } from "@/domain/webhooks";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { emailMessages, emailOptOuts } from "@/server/db/schema";
import {
  previewTransport,
  type EmailTransport,
  type OutgoingEmail,
  type SendResult,
} from "@/server/email/transports";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { CLAIM_LEASE_MS } from "./webhook-delivery";
import { drainDueEmails } from "./email-delivery";

const T0 = new Date("2041-05-01T12:00:00Z");
const after = (base: Date, ms: number) => new Date(base.getTime() + ms);

const rowOf = async (id: string) => {
  const [row] = await getDb().select().from(emailMessages).where(eq(emailMessages.id, id));
  return row!;
};

/** A transport that records what it was given and answers from `script`. */
function scripted(
  script: (index: number) => SendResult | Promise<SendResult> = () => ({
    kind: "sent",
    providerMessageId: "msg_1",
  }),
  name: EmailTransport["name"] = "resend",
) {
  const sent: OutgoingEmail[] = [];
  const transport: EmailTransport = {
    name,
    async send(email) {
      sent.push(email);
      return script(sent.length - 1);
    },
  };
  return { transport, sent };
}

describe("email delivery", () => {
  let admin: AuthContext;

  beforeAll(async () => {
    admin = await createTestContext((await createTestOrganization("Mailer")).id, "admin");
  });
  // A drain claims every due row in the database: park the open rows other tests left behind.
  beforeEach(async () => {
    await getDb()
      .update(emailMessages)
      .set({ nextAttemptAt: new Date("2100-01-01T00:00:00Z") })
      .where(inArray(emailMessages.status, ["pending", "failed"]));
  });

  async function queue(recipient = `c-${crypto.randomUUID()}@example.com`) {
    const shipment = await createTestShipment(admin.organizationId, admin.userId, {
      recipientEmail: recipient,
    });
    const [row] = await getDb()
      .insert(emailMessages)
      .values({
        organizationId: admin.organizationId,
        shipmentId: shipment.id,
        recipient,
        subject: "Your shipment has been delivered",
        textBody: "text body",
        htmlBody: "<p>html body</p>",
        idempotencyKey: `waybill-status-email/${crypto.randomUUID()}`,
        nextAttemptAt: T0,
      })
      .returning();
    return row!;
  }

  it("hands a message to the transport once and records which transport and provider id", async () => {
    const message = await queue();
    const { transport, sent } = scripted();

    expect(
      await drainDueEmails(T0, 50, { transport, from: "Waybill <hi@example.com>" }),
    ).toMatchObject({
      claimed: 1,
      sent: 1,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: "Waybill <hi@example.com>",
      to: message.recipient,
      subject: message.subject,
      text: "text body",
      html: "<p>html body</p>",
      idempotencyKey: message.idempotencyKey,
    });
    expect(sent[0]!.headers!["List-Unsubscribe"]).toMatch(/^<.+\/unsubscribe\/[A-Za-z0-9_.-]+>$/);
    expect(await rowOf(message.id)).toMatchObject({
      status: "succeeded",
      attempts: 1,
      transport: "resend",
      providerMessageId: "msg_1",
      nextAttemptAt: null,
      lastError: null,
    });
    // Done is done.
    expect(await drainDueEmails(after(T0, 10 * 60_000), 50, { transport })).toMatchObject({
      claimed: 0,
    });
    expect(sent).toHaveLength(1);
  });

  it("with the preview transport the stored message is marked as a preview", async () => {
    const message = await queue();
    await drainDueEmails(T0, 50, { transport: previewTransport });
    expect(await rowOf(message.id)).toMatchObject({
      status: "succeeded",
      transport: "preview",
      providerMessageId: null,
    });
  });

  it("retries on the webhook schedule with the same idempotency key, then gives up", async () => {
    const message = await queue();
    const { transport, sent } = scripted(() => ({
      kind: "failed",
      message: "Resend answered 500",
    }));

    let now = T0;
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
      expect(await drainDueEmails(now, 50, { transport })).toMatchObject({ claimed: 1 });
      const row = await rowOf(message.id);
      expect(row.attempts).toBe(attempt);
      if (attempt < MAX_DELIVERY_ATTEMPTS) {
        expect(row).toMatchObject({
          status: "failed",
          lastError: "Resend answered 500",
          nextAttemptAt: after(now, RETRY_DELAYS_MS[attempt - 1]!),
        });
        // Not due a second early.
        expect(
          await drainDueEmails(after(now, RETRY_DELAYS_MS[attempt - 1]! - 1000), 50, { transport }),
        ).toMatchObject({ claimed: 0 });
        now = row.nextAttemptAt!;
      } else {
        expect(row).toMatchObject({ status: "dead", nextAttemptAt: null });
      }
    }
    expect(sent).toHaveLength(MAX_DELIVERY_ATTEMPTS);
    // One key for every attempt: Resend sends the email at most once.
    expect(new Set(sent.map((email) => email.idempotencyKey))).toEqual(
      new Set([message.idempotencyKey]),
    );
  });

  it("ends a message at once when the provider rejects it permanently, without retrying", async () => {
    const message = await queue();
    const { transport, sent } = scripted(() => ({
      kind: "failed",
      message: "Resend answered 403: The example.resend.app domain is not verified.",
      permanent: true,
    }));

    expect(await drainDueEmails(T0, 50, { transport })).toMatchObject({ claimed: 1 });
    expect(await rowOf(message.id)).toMatchObject({
      status: "dead",
      attempts: 1,
      nextAttemptAt: null,
      lastError: "Resend answered 403: The example.resend.app domain is not verified.",
    });
    // Nothing is due later: no retry on the backoff schedule.
    expect(await drainDueEmails(after(T0, 24 * 60 * 60 * 1000), 50, { transport })).toMatchObject({
      claimed: 0,
    });
    expect(sent).toHaveLength(1);
  });

  it("succeeds on a later attempt after a failure", async () => {
    const message = await queue();
    const { transport } = scripted((i) =>
      i === 0
        ? { kind: "failed", message: "Could not reach Resend" }
        : { kind: "sent", providerMessageId: "m2" },
    );
    await drainDueEmails(T0, 50, { transport });
    await drainDueEmails(after(T0, RETRY_DELAYS_MS[0]!), 50, { transport });
    expect(await rowOf(message.id)).toMatchObject({
      status: "succeeded",
      attempts: 2,
      lastError: null,
      providerMessageId: "m2",
    });
  });

  it("suppresses a message whose recipient opted out after it was queued, without sending", async () => {
    const message = await queue();
    await getDb()
      .insert(emailOptOuts)
      .values({ organizationId: admin.organizationId, email: message.recipient });
    const { transport, sent } = scripted();

    expect(await drainDueEmails(T0, 50, { transport })).toMatchObject({
      claimed: 1,
      suppressed: 1,
      sent: 0,
    });

    expect(sent).toHaveLength(0);
    expect(await rowOf(message.id)).toMatchObject({
      status: "suppressed",
      transport: null,
      nextAttemptAt: null,
    });
  });

  it("an opt-out from another organization does not suppress this one's mail", async () => {
    const message = await queue();
    const other = await createTestOrganization("Elsewhere");
    await getDb()
      .insert(emailOptOuts)
      .values({ organizationId: other.id, email: message.recipient });
    const { transport, sent } = scripted();
    await drainDueEmails(T0, 50, { transport });
    expect(sent).toHaveLength(1);
  });

  describe("two drains at once", () => {
    it("a drain that starts while another is mid-send does not send the message again", async () => {
      const message = await queue();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const { transport, sent } = scripted(async () => {
        await gate;
        return { kind: "sent", providerMessageId: "m" };
      });

      const first = drainDueEmails(T0, 50, { transport });
      while (sent.length < 1) await sleep(10);

      expect(await drainDueEmails(after(T0, 1000), 50, { transport })).toMatchObject({
        claimed: 0,
      });
      expect(await rowOf(message.id)).toMatchObject({
        attempts: 1,
        nextAttemptAt: after(T0, CLAIM_LEASE_MS),
      });

      release();
      expect(await first).toMatchObject({ sent: 1 });
      expect(sent).toHaveLength(1);
    });

    it("many concurrent drains send each message exactly once", async () => {
      const messages = [await queue(), await queue(), await queue(), await queue()];
      const { transport, sent } = scripted();
      await Promise.all(Array.from({ length: 6 }, () => drainDueEmails(T0, 2, { transport })));
      await drainDueEmails(T0, 50, { transport });
      const keys = sent.map((email) => email.idempotencyKey);
      expect(new Set(keys).size).toBe(keys.length);
      for (const message of messages)
        expect(keys.filter((k) => k === message.idempotencyKey)).toHaveLength(1);
    });
  });

  it("is backed by CHECK constraints: a transport only on a succeeded message, a due time only on open ones", async () => {
    const message = await queue();
    await expect(
      getDb()
        .update(emailMessages)
        .set({ status: "succeeded", nextAttemptAt: null })
        .where(eq(emailMessages.id, message.id)),
    ).rejects.toThrow();
    await expect(
      getDb()
        .update(emailMessages)
        .set({ transport: "preview" })
        .where(eq(emailMessages.id, message.id)),
    ).rejects.toThrow();
    await expect(
      getDb().update(emailMessages).set({ status: "dead" }).where(eq(emailMessages.id, message.id)),
    ).rejects.toThrow();
    await expect(
      getDb().insert(emailMessages).values({
        organizationId: admin.organizationId,
        shipmentId: message.shipmentId,
        recipient: "x@example.com",
        subject: "s",
        textBody: "t",
        htmlBody: "h",
        idempotencyKey: message.idempotencyKey,
        nextAttemptAt: T0,
      }),
    ).rejects.toThrow();
  });
});
