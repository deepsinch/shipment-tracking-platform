import "server-only";

import { env } from "@/server/env";

import type { RealtimeBus } from "./bus";
import { PostgresRealtimeBus } from "./postgres-bus";

export type { RealtimeBus, RealtimeListener, RealtimeSignal } from "./bus";

// Cached on globalThis, like the DB pool, so development hot reloads keep one listener.
const globalForRealtime = globalThis as typeof globalThis & {
  waybillRealtimeBus?: PostgresRealtimeBus;
};

/**
 * The server instance's realtime bus, created on first use (importing this module needs no
 * environment variables, so `next build` works without a database).
 *
 * The listener connects to the direct URL (`DATABASE_DIRECT_URL`, else `DATABASE_URL_UNPOOLED`
 * as the Neon integration names it): `LISTEN` needs a direct connection, which transaction-mode
 * poolers (PgBouncer, Neon's pooled endpoint) do not provide. Locally there is no pooler, so it
 * falls back to `DATABASE_URL`. Publishing uses the caller's transaction, whatever
 * URL its pool uses.
 */
export function getRealtimeBus(): RealtimeBus {
  if (!globalForRealtime.waybillRealtimeBus) {
    globalForRealtime.waybillRealtimeBus = new PostgresRealtimeBus({
      connectionString: env.database.directUrl,
    });
  }
  return globalForRealtime.waybillRealtimeBus;
}

/** Closes the listener if one was created. For tests and scripts. */
export async function closeRealtimeBus(): Promise<void> {
  const bus = globalForRealtime.waybillRealtimeBus;
  delete globalForRealtime.waybillRealtimeBus;
  await bus?.close();
}
