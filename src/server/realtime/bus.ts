import type { Transaction } from "@/server/db/client";

import type { RealtimeMessage } from "./messages";

/** What a subscriber receives: a message, or the instruction to re-read current state. */
export type RealtimeSignal = RealtimeMessage | ResyncSignal;

/**
 * The subscription is (re)established and messages before it may have been lost. Delivered once
 * when a subscription starts listening, and to every subscriber after the bus reconnects.
 * Because messages are invalidations, re-reading current state is all a subscriber has to do.
 */
export type ResyncSignal = { kind: "resync" };

export type RealtimeListener = (signal: RealtimeSignal) => void;

/**
 * Realtime fan-out, kept behind a small interface so the Postgres implementation could be swapped
 * for a hosted pub/sub (Ably, Pusher, Supabase Realtime) without touching services or the stream.
 */
export interface RealtimeBus {
  /**
   * Announces a change from inside the transaction that made it. Subscribers receive it only if
   * and when that transaction commits.
   */
  publish(tx: Transaction, message: RealtimeMessage): Promise<void>;

  /** Starts receiving signals (first a `resync`). Returns the function that stops them. */
  subscribe(listener: RealtimeListener): () => void;
}
