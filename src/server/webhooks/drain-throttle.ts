import "server-only";

import { sql } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { webhookDrainState } from "@/server/db/schema";

const DRAIN_CLOCK = "drain";

/** At most one activity-driven drain per this interval, across every instance. */
export const DRAIN_INTERVAL_MS = 30_000;

/**
 * Claims the right to run an activity-driven drain: true for exactly one caller per interval.
 * The same conditional upsert as `claimDemoTick` (see there for why a read-then-write check would
 * let two callers through):
 *
 *   INSERT ... ON CONFLICT (name) DO UPDATE SET last_run_at = now WHERE last_run_at <= now - interval
 *
 * This is the right tool here because the callers compete for one shared slot ("who runs the
 * drain in this window?"), and the losers should simply do nothing. The drain itself, which
 * competes for many rows, uses `FOR UPDATE SKIP LOCKED` instead (`webhook-delivery.ts`).
 */
export async function claimWebhookDrain(
  now: Date = new Date(),
  intervalMs: number = DRAIN_INTERVAL_MS,
): Promise<boolean> {
  const windowStart = new Date(now.getTime() - intervalMs);
  const claimed = await getDb()
    .insert(webhookDrainState)
    .values({ name: DRAIN_CLOCK, lastRunAt: now })
    .onConflictDoUpdate({
      target: webhookDrainState.name,
      set: { lastRunAt: now },
      setWhere: sql`${webhookDrainState.lastRunAt} <= ${windowStart}`,
    })
    .returning({ name: webhookDrainState.name });
  return claimed.length > 0;
}
