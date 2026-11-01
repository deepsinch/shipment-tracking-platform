import "server-only";

import { sql } from "drizzle-orm";

import { DEMO_TICK_INTERVAL_MS } from "@/domain/demo";
import { getDb } from "@/server/db/client";
import { demoTickState } from "@/server/db/schema";

const SIMULATOR_CLOCK = "simulator";

/**
 * Claims the right to run the next simulator tick: true for exactly one caller per interval, across
 * every viewer and every server instance.
 *
 * The check and the write are one conditional upsert, the same pattern as the location-ping
 * throttle and the sign-in rate limits:
 *
 *   INSERT ... ON CONFLICT (name) DO UPDATE SET last_tick_at = now
 *     WHERE demo_tick_state.last_tick_at <= now - interval
 *
 * Postgres serializes concurrent upserts of one row: the second waits for the first to commit, then
 * re-evaluates the WHERE against the committed row (now inside the interval) and returns no row.
 * A read-then-write check would let both through. The very first call inserts the row.
 *
 * The claim is made when a tick starts, so a tick that takes longer than the interval can overlap
 * the next one; ticks are short (a few queries per truck) and each action goes through services
 * that are safe under concurrency (conditional status updates, throttled pings).
 */
export async function claimDemoTick(
  now: Date = new Date(),
  intervalMs: number = DEMO_TICK_INTERVAL_MS,
): Promise<boolean> {
  const windowStart = new Date(now.getTime() - intervalMs);
  const claimed = await getDb()
    .insert(demoTickState)
    .values({ name: SIMULATOR_CLOCK, lastTickAt: now })
    .onConflictDoUpdate({
      target: demoTickState.name,
      set: { lastTickAt: now },
      setWhere: sql`${demoTickState.lastTickAt} <= ${windowStart}`,
    })
    .returning({ name: demoTickState.name });
  return claimed.length > 0;
}
