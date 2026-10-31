import { sql } from "drizzle-orm";
import { Client, type Notification } from "pg";

import type { Transaction } from "@/server/db/client";

import type { RealtimeBus, RealtimeListener, RealtimeSignal, ResyncSignal } from "./bus";
import {
  decodeRealtimeMessage,
  encodeRealtimeMessage,
  REALTIME_CHANNEL,
  type RealtimeMessage,
} from "./messages";

export type PostgresRealtimeBusOptions = {
  /**
   * A direct (session) connection: `LISTEN` does not work through transaction-mode poolers such
   * as PgBouncer or Neon's pooled endpoint.
   */
  connectionString: string;
  /** Shown in `pg_stat_activity`, so operators (and tests) can find the listener. */
  applicationName?: string;
  /** How long the listener stays connected after its last subscriber leaves. */
  idleTimeoutMs?: number;
  /** Reconnect backoff: doubles from `initial` up to `max`, with jitter. */
  reconnectDelayMs?: { initial: number; max: number };
  log?: Pick<Console, "warn" | "error">;
};

type State =
  /** No connection and none wanted. */
  | "idle"
  /** Connecting and issuing LISTEN. */
  | "connecting"
  /** LISTEN is active: notifications are being delivered. */
  | "listening"
  /** The connection dropped; a reconnect is scheduled. */
  | "waiting";

const RESYNC: ResyncSignal = { kind: "resync" };

/**
 * The Postgres `LISTEN`/`NOTIFY` implementation of the realtime bus.
 *
 * Publishing is `SELECT pg_notify(...)` on the caller's transaction, so Postgres delivers the
 * message only if that transaction commits; a rolled-back write never announces itself.
 *
 * Receiving uses one dedicated `pg.Client` per server instance (not a pool connection: a pooled
 * connection would be handed to other queries), created when the first subscriber arrives, and
 * fanned out in process to every subscriber. If the connection drops, it reconnects with
 * exponential backoff and then sends every subscriber a `resync`, because notifications sent
 * while it was down are lost.
 *
 * When the last subscriber leaves, the connection is kept for `idleTimeoutMs` before closing.
 * Browsers reconnect their streams regularly (every few minutes, and on page loads), and closing
 * on every short gap would mean a new connection and LISTEN each time.
 */
export class PostgresRealtimeBus implements RealtimeBus {
  private readonly listeners = new Set<RealtimeListener>();
  private readonly options: Required<Omit<PostgresRealtimeBusOptions, "log">>;
  private readonly log: Pick<Console, "warn" | "error">;
  private state: State = "idle";
  private client: Client | null = null;
  /** Incremented whenever the current connection is abandoned; late events from it are ignored. */
  private generation = 0;
  private failedAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private idleTimer: NodeJS.Timeout | undefined;

  constructor(options: PostgresRealtimeBusOptions) {
    this.options = {
      applicationName: "waybill-realtime",
      idleTimeoutMs: 30_000,
      reconnectDelayMs: { initial: 250, max: 10_000 },
      ...options,
    };
    this.log = options.log ?? console;
  }

  async publish(tx: Transaction, message: RealtimeMessage): Promise<void> {
    const payload = encodeRealtimeMessage(message);
    await tx.execute(sql`SELECT pg_notify(${REALTIME_CHANNEL}, ${payload})`);
  }

  subscribe(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    clearTimeout(this.idleTimer);

    if (this.state === "listening") {
      // Already listening: this subscriber starts now. Deliver after returning, so the caller
      // holds its unsubscribe function before its listener first runs.
      queueMicrotask(() => {
        if (this.listeners.has(listener)) this.deliver(listener, RESYNC);
      });
    } else if (this.state === "idle") {
      void this.connect();
    }
    // "connecting" and "waiting": the resync follows once LISTEN is active.

    return () => {
      if (!this.listeners.delete(listener)) return;
      if (this.listeners.size === 0) this.scheduleIdleClose();
    };
  }

  /** Closes the listener connection and drops every subscriber. For tests and shutdown. */
  async close(): Promise<void> {
    this.listeners.clear();
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    this.state = "connecting";
    const client = new Client({
      connectionString: this.options.connectionString,
      application_name: this.options.applicationName,
      // Detects a silently dead connection (NAT timeout, failover) at the TCP level.
      keepAlive: true,
    });
    this.client = client;

    client.on("notification", (notification) => {
      if (generation === this.generation) this.dispatch(notification);
    });
    client.on("error", (error) => this.handleDrop(generation, client, error));
    client.on("end", () => this.handleDrop(generation, client));

    try {
      await client.connect();
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
    } catch (error) {
      this.handleDrop(generation, client, error);
      return;
    }
    // Closed or dropped while connecting: that path has already cleaned up.
    if (generation !== this.generation) return;

    this.state = "listening";
    this.failedAttempts = 0;
    for (const listener of [...this.listeners]) this.deliver(listener, RESYNC);
  }

  private handleDrop(generation: number, client: Client, error?: unknown): void {
    // The connection emits both "error" and "end" when it dies; handle it once.
    if (generation !== this.generation) return;
    this.generation++;
    this.client = null;
    void this.abandon(client);

    if (this.listeners.size === 0) {
      this.state = "idle";
      return;
    }
    const { initial, max } = this.options.reconnectDelayMs;
    const backoff = Math.min(max, initial * 2 ** this.failedAttempts);
    // Jitter, so instances that lost the database together do not reconnect in lockstep.
    const delay = Math.round(backoff * (0.5 + Math.random() / 2));
    this.failedAttempts++;
    this.state = "waiting";
    this.log.warn(
      `[realtime] listener connection lost (${describe(error)}); reconnecting in ${delay} ms`,
    );
    this.reconnectTimer = setTimeout(() => void this.connect(), delay);
    this.reconnectTimer.unref();
  }

  private dispatch(notification: Notification): void {
    if (notification.channel !== REALTIME_CHANNEL) return;
    const message = decodeRealtimeMessage(notification.payload ?? "");
    if (!message) {
      // Never forward what we cannot vouch for. Truncated: the payload is not trusted input.
      this.log.warn(
        `[realtime] dropped a malformed message: ${JSON.stringify(notification.payload?.slice(0, 200))}`,
      );
      return;
    }
    for (const listener of [...this.listeners]) this.deliver(listener, message);
  }

  /** One failing subscriber must not stop delivery to the others. */
  private deliver(listener: RealtimeListener, signal: RealtimeSignal): void {
    try {
      listener(signal);
    } catch (error) {
      this.log.error("[realtime] a subscriber threw", error);
    }
  }

  private scheduleIdleClose(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.listeners.size === 0) void this.disconnect();
    }, this.options.idleTimeoutMs);
    this.idleTimer.unref();
  }

  private async disconnect(): Promise<void> {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.idleTimer);
    this.generation++;
    this.state = "idle";
    const client = this.client;
    this.client = null;
    if (client) await this.abandon(client);
  }

  /** Ends a connection we no longer use, without letting its late errors escape. */
  private async abandon(client: Client): Promise<void> {
    // An EventEmitter "error" with no listener would crash the process.
    client.removeAllListeners();
    client.on("error", () => {});
    await client.end().catch(() => {});
  }
}

function describe(error: unknown): string {
  if (!error) return "connection ended";
  return error instanceof Error ? error.message : String(error);
}
