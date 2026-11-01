import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "@/server/auth/auth-context";

import type { RealtimeBus, RealtimeListener } from "./bus";
import type { RealtimeMessage } from "./messages";
import { createRealtimeStream, sseEvent, streamLifetimeMs } from "./sse-stream";

const shipmentId = "6f1c1d5e-4a8b-4c3e-9f0a-1b2c3d4e5f60";
const otherShipmentId = "7a2d2e6f-5b9c-4d4f-8a1b-2c3d4e5f6071";

const dispatcher: AuthContext = { userId: "disp-1", organizationId: "org-a", role: "dispatcher" };

const changed = (overrides: Partial<RealtimeMessage> = {}) =>
  ({
    kind: "shipment_changed",
    organizationId: "org-a",
    shipmentId,
    assignedDriverId: null,
    previousDriverId: null,
    reason: "status",
    ...overrides,
  }) as RealtimeMessage;

/** An in-memory bus that records subscriptions, so tests can push signals and check cleanup. */
function fakeBus() {
  const listeners = new Set<RealtimeListener>();
  const bus: RealtimeBus = {
    publish: async () => {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    bus,
    listeners,
    emit: (signal: Parameters<RealtimeListener>[0]) => listeners.forEach((l) => l(signal)),
  };
}

/** Collects the text written to the stream, as the client would read it. */
function readAll(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const state = { text: "", done: false };
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      state.text += decoder.decode(value);
    }
    state.done = true;
  })();
  return { state, reader };
}

describe("createRealtimeStream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function open(viewer: AuthContext = dispatcher, lifetimeMs = 60_000) {
    const fake = fakeBus();
    const abort = new AbortController();
    const stream = createRealtimeStream({
      viewer,
      bus: fake.bus,
      signal: abort.signal,
      lifetimeMs,
      heartbeatMs: 25_000,
      retryMs: 3_000,
    });
    const { state, reader } = readAll(stream);
    return { ...fake, abort, state, reader };
  }

  it("starts with the reconnect delay and passes resync on", async () => {
    const s = open();
    s.emit({ kind: "resync" });
    await vi.advanceTimersByTimeAsync(0);

    expect(s.state.text).toBe(`retry: 3000\n\n${sseEvent({ kind: "resync" })}`);
  });

  it("writes visible messages as client events and skips the rest", async () => {
    const s = open({ userId: "driver-1", organizationId: "org-a", role: "driver" });
    s.emit(changed({ assignedDriverId: "driver-2" }));
    s.emit(changed({ organizationId: "org-b", assignedDriverId: "driver-1" }));
    s.emit(changed({ shipmentId: otherShipmentId, assignedDriverId: "driver-1" }));
    await vi.advanceTimersByTimeAsync(0);

    expect(s.state.text).toBe(
      `retry: 3000\n\n` +
        sseEvent({ kind: "shipment_changed", shipmentId: otherShipmentId, reason: "status" }),
    );
  });

  it("sends a heartbeat comment every 25 seconds", async () => {
    const s = open();
    await vi.advanceTimersByTimeAsync(24_999);
    expect(s.state.text).not.toContain("heartbeat");
    await vi.advanceTimersByTimeAsync(1);
    expect(s.state.text).toContain(": heartbeat\n\n");
    await vi.advanceTimersByTimeAsync(25_000);
    expect(s.state.text.match(/heartbeat/g)).toHaveLength(2);
  });

  it("closes itself after its lifetime and unsubscribes", async () => {
    const s = open(dispatcher, 60_000);
    expect(s.listeners.size).toBe(1);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(s.state.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(s.state.done).toBe(true);
    expect(s.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up when the client disconnects", async () => {
    const s = open();
    s.abort.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect(s.state.done).toBe(true);
    expect(s.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up when the reader cancels", async () => {
    const s = open();
    await s.reader.cancel();

    expect(s.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never subscribes for a request that was already aborted", () => {
    const fake = fakeBus();
    const abort = new AbortController();
    abort.abort();
    createRealtimeStream({
      viewer: dispatcher,
      bus: fake.bus,
      signal: abort.signal,
      lifetimeMs: 1,
    });

    expect(fake.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops a client that stops reading", async () => {
    const fake = fakeBus();
    createRealtimeStream({
      viewer: dispatcher,
      bus: fake.bus,
      signal: new AbortController().signal,
      lifetimeMs: 60_000,
    });
    // Nobody reads: events queue up until the limit, then the stream gives up on the client.
    for (let i = 0; i < 600; i++) fake.emit(changed());

    expect(fake.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("streamLifetimeMs", () => {
  it("defaults to 270 seconds, below the route's 300-second maxDuration", () => {
    expect(streamLifetimeMs(undefined)).toBe(270_000);
  });

  it("accepts an override, clamped below maxDuration", () => {
    expect(streamLifetimeMs(30)).toBe(30_000);
    expect(streamLifetimeMs(600)).toBe(290_000);
    expect(streamLifetimeMs(1)).toBe(5_000);
  });

  // A malformed REALTIME_STREAM_SECONDS ("soon") is rejected by the env schema (env.test.ts)
  // instead of silently falling back to the default.
});
