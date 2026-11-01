import "server-only";

import { lt } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { authRateLimits, locationPings } from "@/server/db/schema";

/** How long raw location pings are kept (docs/architecture.md, decision 48). */
export const LOCATION_PING_RETENTION_DAYS = 30;
/** How long an expired rate-limit window lingers before it is deleted. */
export const RATE_LIMIT_GRACE_DAYS = 1;

const DAY_MS = 24 * 60 * 60_000;

export type PurgeResult = { locationPings: number; authRateLimits: number };

/**
 * Deletes data that is only useful for a while, in one transaction: location pings received more
 * than 30 days before `now`, and rate-limit windows that started more than a day before `now`
 * (the longest window is far shorter, so the row is long expired). Never touches
 * `shipment_events` or `shipment_positions`, which are history or current state.
 */
export async function purgeExpiredData(now: Date = new Date()): Promise<PurgeResult> {
  const pingCutoff = new Date(now.getTime() - LOCATION_PING_RETENTION_DAYS * DAY_MS);
  const rateLimitCutoff = new Date(now.getTime() - RATE_LIMIT_GRACE_DAYS * DAY_MS);

  return getDb().transaction(async (tx) => {
    const pings = await tx
      .delete(locationPings)
      .where(lt(locationPings.receivedAt, pingCutoff))
      .returning({ id: locationPings.id });
    const limits = await tx
      .delete(authRateLimits)
      .where(lt(authRateLimits.windowStart, rateLimitCutoff))
      .returning({ key: authRateLimits.key });
    return { locationPings: pings.length, authRateLimits: limits.length };
  });
}
