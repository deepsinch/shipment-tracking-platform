import { parseRealtimeClientEvent, type RealtimeClientEvent } from "./realtime-events";

/**
 * - `connecting`: first connection, nothing received yet.
 * - `live`: the server confirmed the subscription (a `resync` arrived).
 * - `reconnecting`: the connection dropped and has not come back within the grace period.
 */
export type RealtimeStatus = "connecting" | "live" | "reconnecting";

/** The part of `EventSource` this module uses, so tests can pass a fake. */
export type EventSourceLike = {
  readonly readyState: number;
  onmessage: ((message: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
};

/** `EventSource.CLOSED`: the browser gave up and will not retry by itself. */
const CLOSED = 2;

export type RealtimeConnectionOptions = {
  url: string;
  onEvent: (event: RealtimeClientEvent) => void;
  onStatus: (status: RealtimeStatus) => void;
  createEventSource?: (url: string) => EventSourceLike;
  /**
   * How long a dropped connection may take to come back before the status says `reconnecting`.
   * Longer than the server's `retry:` (3 s), so the routine reconnect every few minutes (the
   * stream closes itself before the platform's time limit) does not flash the indicator.
   */
  reconnectGraceMs?: number;
  /** Backoff for reopening after the browser gave up (e.g. a 401 or 502 answer). */
  reopenDelayMs?: { initial: number; max: number };
};

/**
 * Opens the realtime stream and keeps it open. Returns the function that closes it.
 *
 * `EventSource` reconnects by itself after a dropped stream (waiting the server's `retry:`). It
 * gives up only when an answer is not a 200 event stream (signed out, a deploy returning 502);
 * then this reopens it with exponential backoff, because the page has no other way back.
 *
 * Every (re)connection starts with a `resync` event from the server, which callers treat as
 * "re-read your data"; the status turns `live` only then, once the server is really listening.
 */
export function connectRealtime({
  url,
  onEvent,
  onStatus,
  createEventSource = (target) => new EventSource(target),
  reconnectGraceMs = 5_000,
  reopenDelayMs = { initial: 2_000, max: 60_000 },
}: RealtimeConnectionOptions): () => void {
  let source: EventSourceLike | null = null;
  let status: RealtimeStatus | null = null;
  let failedReopens = 0;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let reopenTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const setStatus = (next: RealtimeStatus) => {
    if (next === status) return;
    status = next;
    onStatus(next);
  };

  const open = () => {
    const current = createEventSource(url);
    source = current;

    current.onmessage = (message) => {
      const event = parseRealtimeClientEvent(message.data);
      if (!event) return;
      if (event.kind === "resync") {
        clearTimeout(graceTimer);
        graceTimer = undefined;
        failedReopens = 0;
        setStatus("live");
      }
      onEvent(event);
    };

    current.onerror = () => {
      if (closed || current !== source) return;
      if (status === "live" && graceTimer === undefined) {
        graceTimer = setTimeout(() => setStatus("reconnecting"), reconnectGraceMs);
      }
      if (current.readyState === CLOSED) {
        current.close();
        const { initial, max } = reopenDelayMs;
        const delay = Math.min(max, initial * 2 ** failedReopens);
        failedReopens++;
        reopenTimer = setTimeout(open, delay);
      }
    };
  };

  setStatus("connecting");
  open();

  return () => {
    closed = true;
    clearTimeout(graceTimer);
    clearTimeout(reopenTimer);
    source?.close();
  };
}
