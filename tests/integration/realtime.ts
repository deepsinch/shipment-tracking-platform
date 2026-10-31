import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { getDb } from "@/server/db/client";
import { getRealtimeBus, type RealtimeSignal } from "@/server/realtime";
import type { RealtimeMessage } from "@/server/realtime/messages";

/** Polls `check` until it returns true, or fails with `what` after about five seconds. */
export async function eventually(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await sleep(25);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/**
 * Subscribes to the app's realtime bus (the one services publish to) and records every message.
 *
 * Proving that something was NOT announced needs a sentinel: `flush()` publishes a message of its
 * own and waits for it. Postgres delivers notifications in commit order over one connection, so
 * once the sentinel has arrived, anything committed before it has arrived too.
 */
export async function recordRealtime() {
  const signals: RealtimeSignal[] = [];
  const unsubscribe = getRealtimeBus().subscribe((signal) => signals.push(signal));
  await eventually(() => signals.some((s) => s.kind === "resync"), "the bus to start listening");

  const messages = () => signals.filter((s): s is RealtimeMessage => s.kind !== "resync");

  return {
    /** Messages about one shipment, in arrival order. */
    about: (shipmentId: string) => messages().filter((m) => m.shipmentId === shipmentId),
    async flush() {
      const sentinel: RealtimeMessage = {
        kind: "shipment_changed",
        organizationId: `sentinel-${randomUUID()}`,
        shipmentId: randomUUID(),
        assignedDriverId: null,
        previousDriverId: null,
        reason: "status",
      };
      await getDb().transaction((tx) => getRealtimeBus().publish(tx, sentinel));
      await eventually(
        () => messages().some((m) => m.shipmentId === sentinel.shipmentId),
        "the realtime sentinel",
      );
    },
    unsubscribe,
  };
}
