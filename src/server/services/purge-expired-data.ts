import "server-only";

import { and, inArray, lt } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import {
  authRateLimits,
  emailMessages,
  locationPings,
  webhookDeliveries,
} from "@/server/db/schema";

/** How long raw location pings are kept (docs/architecture.md, decision 48). */
export const LOCATION_PING_RETENTION_DAYS = 30;
/** How long an expired rate-limit window lingers before it is deleted. */
export const RATE_LIMIT_GRACE_DAYS = 1;

/**
 * How long finished webhook deliveries and customer emails are kept. They are delivery logs, not
 * history: payloads and bodies repeat what `shipment_events` already records, and bodies hold
 * recipient addresses, so they should not live forever.
 */
export const DELIVERY_LOG_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60_000;

export type PurgeResult = {
  locationPings: number;
  authRateLimits: number;
  webhookDeliveries: number;
  emailMessages: number;
};

/**
 * Deletes data that is only useful for a while, in one transaction: location pings received more
 * than 30 days before `now`, and rate-limit windows that started more than a day before `now`
 * (the longest window is far shorter, so the row is long expired), and webhook deliveries and
 * emails in a final state created more than 90 days before `now`. Open rows (pending, failed) are
 * never deleted, however old: a drain still owns them.
 *
 * Kept by design, never purged: `shipment_events` (the append-only history, which also makes the
 * delivery logs redundant), `shipment_positions` (current state) and delivery proofs (signature,
 * photo and printed name are the evidence of who received the goods; carriers need them for
 * claims and disputes long after 90 days, so any retention period is a legal decision for the
 * operator, not a default for the platform).
 */
export async function purgeExpiredData(now: Date = new Date()): Promise<PurgeResult> {
  const pingCutoff = new Date(now.getTime() - LOCATION_PING_RETENTION_DAYS * DAY_MS);
  const rateLimitCutoff = new Date(now.getTime() - RATE_LIMIT_GRACE_DAYS * DAY_MS);
  const logCutoff = new Date(now.getTime() - DELIVERY_LOG_RETENTION_DAYS * DAY_MS);

  return getDb().transaction(async (tx) => {
    const pings = await tx
      .delete(locationPings)
      .where(lt(locationPings.receivedAt, pingCutoff))
      .returning({ id: locationPings.id });
    const limits = await tx
      .delete(authRateLimits)
      .where(lt(authRateLimits.windowStart, rateLimitCutoff))
      .returning({ key: authRateLimits.key });
    const deliveries = await tx
      .delete(webhookDeliveries)
      .where(
        and(
          inArray(webhookDeliveries.status, ["succeeded", "dead"]),
          lt(webhookDeliveries.createdAt, logCutoff),
        ),
      )
      .returning({ id: webhookDeliveries.id });
    const emails = await tx
      .delete(emailMessages)
      .where(
        and(
          inArray(emailMessages.status, ["succeeded", "dead", "suppressed"]),
          lt(emailMessages.createdAt, logCutoff),
        ),
      )
      .returning({ id: emailMessages.id });
    return {
      locationPings: pings.length,
      authRateLimits: limits.length,
      webhookDeliveries: deliveries.length,
      emailMessages: emails.length,
    };
  });
}
