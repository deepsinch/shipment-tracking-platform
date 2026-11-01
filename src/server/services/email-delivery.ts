import "server-only";

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import { OPEN_DELIVERY_STATUSES, transitionAfterAttempt } from "@/domain/webhooks";
import { getDb } from "@/server/db/client";
import { emailMessages, emailOptOuts, type EmailMessageRow } from "@/server/db/schema";
import {
  createResendTransport,
  previewTransport,
  type EmailTransport,
} from "@/server/email/transports";
import { unsubscribeUrlFor } from "@/server/email/unsubscribe";
import { env } from "@/server/env";

import { CLAIM_LEASE_MS, DRAIN_BATCH_SIZE } from "./webhook-delivery";

/**
 * Sending queued customer emails: the same machinery as webhook deliveries (see
 * `webhook-delivery.ts` for why a short claim transaction with `FOR UPDATE SKIP LOCKED` plus a
 * lease, and no transaction open across the network call), the same retry schedule and the same
 * pure state transitions (`transitionAfterAttempt`: 1 min, 5 min, 30 min, 2 h, 6 h, then dead).
 *
 * Two differences: the recipient's opt-out is checked at send time too (they may have
 * unsubscribed since the message was queued), which ends the message as `suppressed`; and the
 * transport is chosen per drain from the environment (`env.email.transport`), so enabling Resend
 * needs no code change, and queued previews are simply marked as handled.
 */

export type EmailDeps = {
  /** Injectable for tests; defaults to the transport the environment selects. */
  transport?: EmailTransport;
  /** The sender address; defaults to `EMAIL_FROM`. */
  from?: string;
};

export type EmailDrainResult = {
  claimed: number;
  sent: number;
  suppressed: number;
  failed: number;
  dead: number;
};

const OPEN = [...OPEN_DELIVERY_STATUSES];

function defaultTransport(): EmailTransport {
  const { transport, resendApiKey } = env.email;
  return transport === "resend" && resendApiKey
    ? createResendTransport({ apiKey: resendApiKey })
    : previewTransport;
}

export async function drainDueEmails(
  now: Date = new Date(),
  limit: number = DRAIN_BATCH_SIZE,
  deps: EmailDeps = {},
): Promise<EmailDrainResult> {
  const claimed = await claimDueEmails(now, limit);
  const result: EmailDrainResult = {
    claimed: claimed.length,
    sent: 0,
    suppressed: 0,
    failed: 0,
    dead: 0,
  };
  if (claimed.length === 0) return result;

  const transport = deps.transport ?? defaultTransport();
  const outcomes = await Promise.all(
    claimed.map((message) => attempt(message, transport, deps, now)),
  );
  for (const outcome of outcomes) if (outcome) result[outcome] += 1;
  return result;
}

/** Drains in batches until nothing is due or `maxBatches` is reached (the daily cron). */
export async function drainEmailBacklog(
  maxBatches: number = 10,
  now: () => Date = () => new Date(),
  deps: EmailDeps = {},
): Promise<EmailDrainResult> {
  const total: EmailDrainResult = { claimed: 0, sent: 0, suppressed: 0, failed: 0, dead: 0 };
  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await drainDueEmails(now(), DRAIN_BATCH_SIZE, deps);
    for (const key of Object.keys(total) as (keyof EmailDrainResult)[]) total[key] += result[key];
    if (result.claimed < DRAIN_BATCH_SIZE) break;
  }
  return total;
}

async function claimDueEmails(now: Date, limit: number): Promise<EmailMessageRow[]> {
  return getDb().transaction(async (tx) => {
    const due = await tx
      .select({ id: emailMessages.id })
      .from(emailMessages)
      .where(and(inArray(emailMessages.status, OPEN), lte(emailMessages.nextAttemptAt, now)))
      .orderBy(asc(emailMessages.nextAttemptAt), asc(emailMessages.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];

    return tx
      .update(emailMessages)
      .set({
        attempts: sql`${emailMessages.attempts} + 1`,
        nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
        lastAttemptAt: now,
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            emailMessages.id,
            due.map((row) => row.id),
          ),
          inArray(emailMessages.status, OPEN),
          lte(emailMessages.nextAttemptAt, now),
        ),
      )
      .returning();
  });
}

async function attempt(
  message: EmailMessageRow,
  transport: EmailTransport,
  deps: EmailDeps,
  now: Date,
): Promise<"sent" | "suppressed" | "failed" | "dead" | null> {
  const db = getDb();
  // Recorded only for the attempt that was claimed (`attempts` unchanged, still open).
  const claimed = and(
    eq(emailMessages.id, message.id),
    eq(emailMessages.attempts, message.attempts),
    inArray(emailMessages.status, OPEN),
  );

  const [optedOut] = await db
    .select({ email: emailOptOuts.email })
    .from(emailOptOuts)
    .where(
      and(
        eq(emailOptOuts.organizationId, message.organizationId),
        eq(emailOptOuts.email, message.recipient),
      ),
    )
    .limit(1);
  if (optedOut) {
    const updated = await db
      .update(emailMessages)
      .set({ status: "suppressed", nextAttemptAt: null, lastError: null, updatedAt: now })
      .where(claimed)
      .returning({ id: emailMessages.id });
    return updated.length > 0 ? "suppressed" : null;
  }

  const unsubscribeUrl = unsubscribeUrlFor({
    organizationId: message.organizationId,
    email: message.recipient,
  });
  const sent = await transport.send({
    from: deps.from ?? env.email.from ?? "Waybill <notifications@localhost>",
    to: message.recipient,
    subject: message.subject,
    text: message.textBody,
    html: message.htmlBody,
    idempotencyKey: message.idempotencyKey,
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
  });

  if (sent.kind === "sent") {
    const updated = await db
      .update(emailMessages)
      .set({
        status: "succeeded",
        nextAttemptAt: null,
        lastError: null,
        transport: transport.name,
        providerMessageId: sent.providerMessageId,
        updatedAt: now,
      })
      .where(claimed)
      .returning({ id: emailMessages.id });
    return updated.length > 0 ? "sent" : null;
  }

  const transition = transitionAfterAttempt(message.attempts, false, now);
  if (transition.status === "succeeded")
    throw new Error("unreachable: a failed attempt cannot succeed");
  const updated = await db
    .update(emailMessages)
    .set({
      status: transition.status,
      nextAttemptAt: transition.nextAttemptAt,
      lastError: sent.message,
      updatedAt: now,
    })
    .where(claimed)
    .returning({ id: emailMessages.id });
  return updated.length > 0 ? transition.status : null;
}
