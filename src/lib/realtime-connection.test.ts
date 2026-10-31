import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { connectRealtime, type EventSourceLike, type RealtimeStatus } from "./realtime-connection";
import type { RealtimeClientEvent } from "./realtime-events";

/** A controllable stand-in for the browser's EventSource. */
class FakeEventSource implements EventSourceLike {
  readyState = 0;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  receive(data: unknown) {
    this.readyState = 1;
    const text = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent("message", { data: text }));
  }
  /** The stream dropped; the browser will retry by itself. */
  drop() {
    this.readyState = 0;
    this.onerror?.(new Event("error"));
  }
  /** The browser gave up (e.g. a 401 answer). */
  fail() {
    this.readyState = 2;
    this.onerror?.(new Event("error"));
  }
}

describe("connectRealtime", () => {
  let sources: FakeEventSource[];
  let statuses: RealtimeStatus[];
  let events: RealtimeClientEvent[];
  let close: () => void;
  const latest = () => sources.at(-1)!;

  beforeEach(() => {
    vi.useFakeTimers();
    sources = [];
    statuses = [];
    events = [];
    close = connectRealtime({
      url: "/api/realtime",
      onEvent: (event) => events.push(event),
      onStatus: (status) => statuses.push(status),
      createEventSource: () => {
        const source = new FakeEventSource();
        sources.push(source);
        return source;
      },
      reconnectGraceMs: 5_000,
      reopenDelayMs: { initial: 2_000, max: 8_000 },
    });
  });

  afterEach(() => {
    close();
    vi.useRealTimers();
  });

  it("is live only once the server's resync arrives, and passes events on", () => {
    expect(statuses).toEqual(["connecting"]);
    latest().receive({ kind: "resync" });
    latest().receive({ kind: "shipment_changed", shipmentId: "s1", reason: "status" });

    expect(statuses).toEqual(["connecting", "live"]);
    expect(events).toEqual([
      { kind: "resync" },
      { kind: "shipment_changed", shipmentId: "s1", reason: "status" },
    ]);
  });

  it("ignores events it cannot parse", () => {
    latest().receive("not json");
    latest().receive({ kind: "from_the_future" });
    expect(events).toEqual([]);
  });

  it("does not report a routine reconnect that comes back within the grace period", () => {
    latest().receive({ kind: "resync" });
    latest().drop();
    vi.advanceTimersByTime(3_000);
    latest().receive({ kind: "resync" });
    vi.advanceTimersByTime(10_000);

    expect(statuses).toEqual(["connecting", "live"]);
    // The browser reconnected the same EventSource; each connection resyncs.
    expect(sources).toHaveLength(1);
    expect(events).toEqual([{ kind: "resync" }, { kind: "resync" }]);
  });

  it("reports reconnecting when the connection stays down, then live again", () => {
    latest().receive({ kind: "resync" });
    latest().drop();
    vi.advanceTimersByTime(5_000);
    expect(statuses.at(-1)).toBe("reconnecting");

    latest().receive({ kind: "resync" });
    expect(statuses).toEqual(["connecting", "live", "reconnecting", "live"]);
  });

  it("reopens with backoff when the browser gives up", () => {
    latest().receive({ kind: "resync" });
    latest().fail();
    expect(sources[0]!.closed).toBe(true);

    vi.advanceTimersByTime(1_999);
    expect(sources).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(2);

    latest().fail();
    vi.advanceTimersByTime(4_000);
    expect(sources).toHaveLength(3);
    latest().fail();
    vi.advanceTimersByTime(8_000);
    expect(sources).toHaveLength(4);
    latest().fail();
    // Capped at the maximum delay.
    vi.advanceTimersByTime(8_000);
    expect(sources).toHaveLength(5);
    expect(statuses.at(-1)).toBe("reconnecting");

    // A successful connection resets the backoff.
    latest().receive({ kind: "resync" });
    latest().fail();
    vi.advanceTimersByTime(2_000);
    expect(sources).toHaveLength(6);
  });

  it("closes the stream and stops reopening when closed", () => {
    latest().fail();
    close();
    vi.advanceTimersByTime(60_000);

    expect(sources).toHaveLength(1);
    expect(latest().closed).toBe(true);
  });
});
