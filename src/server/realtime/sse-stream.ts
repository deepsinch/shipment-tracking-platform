import type { RealtimeClientEvent } from "@/lib/realtime-events";
import type { AuthContext } from "@/server/auth/auth-context";

import type { RealtimeBus } from "./bus";
import { isVisibleTo, toClientEvent } from "./visibility";

/** Response headers for the event stream. */
export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // `no-transform` stops Next's gzip compression (and proxies that honour it) from buffering the
  // stream until a compression block fills up.
  "Cache-Control": "no-cache, no-transform",
  // nginx and compatible proxies: pass events through immediately.
  "X-Accel-Buffering": "no",
};

/** Comment lines keep idle proxies and load balancers from closing the connection. */
export const HEARTBEAT_MS = 25_000;
/** How long the browser waits before reconnecting after the stream ends (SSE `retry:`). */
export const RETRY_MS = 3_000;
/**
 * A client that stops reading (a frozen tab, a dead network) is dropped once this many events are
 * queued for it. It reconnects and resyncs like after any other disconnect.
 */
const MAX_QUEUED_EVENTS = 500;

/** Default stream lifetime: comfortably below the route's `maxDuration` of 300 s. */
const DEFAULT_LIFETIME_SECONDS = 270;
const MIN_LIFETIME_SECONDS = 5;
const MAX_LIFETIME_SECONDS = 290;

/**
 * How long one stream stays open before closing itself so the browser reconnects cleanly, instead
 * of the platform killing the function at its time limit. `configuredSeconds` (from
 * `REALTIME_STREAM_SECONDS`, validated in `src/server/env.ts`) overrides the default, clamped to
 * stay below `maxDuration`.
 */
export function streamLifetimeMs(configuredSeconds: number | undefined): number {
  const seconds = configuredSeconds ?? DEFAULT_LIFETIME_SECONDS;
  return Math.min(MAX_LIFETIME_SECONDS, Math.max(MIN_LIFETIME_SECONDS, seconds)) * 1000;
}

/** One SSE event carrying a JSON payload on a single `data:` line. */
export function sseEvent(event: RealtimeClientEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export type RealtimeStreamOptions = {
  /** The connection's AuthContext, from the server-side session. */
  viewer: AuthContext;
  bus: RealtimeBus;
  /** Aborts when the client disconnects (`request.signal`). */
  signal: AbortSignal;
  /** Close after this long; see `streamLifetimeMs`. */
  lifetimeMs: number;
  heartbeatMs?: number;
  retryMs?: number;
};

/**
 * The body of `/api/realtime`: realtime signals for one signed-in user as Server-Sent Events.
 *
 * Every message is checked with `isVisibleTo(viewer, ...)` and projected with `toClientEvent`
 * before anything is written, so a stream never carries another organization's (or, for a
 * driver, another driver's) shipments. The bus's `resync` signals are passed on: the first one
 * means "the subscription is live, load the current state".
 *
 * The stream ends itself after `lifetimeMs`, when the client disconnects, or when the client
 * falls too far behind; every path unsubscribes from the bus and clears the timers exactly once.
 */
export function createRealtimeStream({
  viewer,
  bus,
  signal,
  lifetimeMs,
  heartbeatMs = HEARTBEAT_MS,
  retryMs = RETRY_MS,
}: RealtimeStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let stop = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let stopped = false;
      const cleanups: (() => void)[] = [];
      /** Registers what `stop` must undo; runs it at once if the stream already stopped. */
      const onStop = (cleanup: () => void) => {
        if (stopped) cleanup();
        else cleanups.push(cleanup);
      };

      stop = () => {
        if (stopped) return;
        stopped = true;
        for (const cleanup of cleanups) cleanup();
        try {
          controller.close();
        } catch {
          // Already closed or errored because the client went away.
        }
      };

      const send = (text: string) => {
        if (stopped) return;
        if ((controller.desiredSize ?? 0) < -MAX_QUEUED_EVENTS) {
          stop();
          return;
        }
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          stop();
        }
      };

      if (signal.aborted) {
        stop();
        return;
      }
      signal.addEventListener("abort", stop, { once: true });
      onStop(() => signal.removeEventListener("abort", stop));

      send(`retry: ${retryMs}\n\n`);
      onStop(
        bus.subscribe((received) => {
          if (received.kind === "resync") send(sseEvent({ kind: "resync" }));
          else if (isVisibleTo(viewer, received)) send(sseEvent(toClientEvent(received)));
        }),
      );
      const heartbeat = setInterval(() => send(": heartbeat\n\n"), heartbeatMs);
      onStop(() => clearInterval(heartbeat));
      const lifetime = setTimeout(stop, lifetimeMs);
      onStop(() => clearTimeout(lifetime));
    },
    cancel() {
      stop();
    },
  });
}
