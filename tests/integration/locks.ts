import { setTimeout as sleep } from "node:timers/promises";

import { getDb } from "../../src/server/db/client";

/**
 * Waits until `count` backends of the current database are blocked on a lock. For forced races:
 * a third transaction holds a row lock, the contenders are started, and only once all of them are
 * queued behind it is the lock released, so they really do run at the same moment.
 */
export async function waitForLockWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await getDb().$client.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0]!.waiting >= count) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${count} blocked transactions`);
}
