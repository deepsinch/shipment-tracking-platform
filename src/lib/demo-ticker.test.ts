import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDemoTicker, type DemoTickerOptions, type TickOutcome } from "./demo-ticker";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setUp(overrides: Partial<DemoTickerOptions> = {}) {
  const state = { hidden: false, outcome: "continue" as TickOutcome };
  const signals: AbortSignal[] = [];
  const tick = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal);
    return state.outcome;
  });
  const ticker = createDemoTicker({
    tick,
    isHidden: () => state.hidden,
    intervalMs: 12_000,
    jitterMs: 3_000,
    startDelayMs: 1_000,
    random: () => 0.5,
    ...overrides,
  });
  return { state, tick, signals, ticker };
}

describe("createDemoTicker", () => {
  it("asks once after the start delay, then every interval plus jitter", async () => {
    const { tick, ticker } = setUp();
    ticker.start();

    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tick).toHaveBeenCalledTimes(1);

    // 12 s + 0.5 * 3 s = 13.5 s later, not before.
    await vi.advanceTimersByTimeAsync(13_499);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(13_500);
    expect(tick).toHaveBeenCalledTimes(3);
    ticker.stop();
  });

  it("never asks sooner than the server's interval, whatever the jitter draws", async () => {
    const { tick, ticker } = setUp({ random: () => 0 });
    ticker.start();
    await vi.advanceTimersByTimeAsync(1_000);

    await vi.advanceTimersByTimeAsync(11_999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    ticker.stop();
  });

  it("does not overlap requests: the next waits for the previous to finish", async () => {
    let finish: (outcome: TickOutcome) => void = () => {};
    const tick = vi.fn(() => new Promise<TickOutcome>((resolve) => (finish = resolve)));
    const ticker = createDemoTicker({
      tick,
      isHidden: () => false,
      intervalMs: 12_000,
      jitterMs: 0,
      startDelayMs: 0,
    });
    ticker.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(1);

    finish("continue");
    await vi.advanceTimersByTimeAsync(12_000);
    expect(tick).toHaveBeenCalledTimes(2);
    ticker.stop();
  });

  it("does not start in a hidden tab, and starts once it is shown", async () => {
    const { state, tick, ticker } = setUp();
    state.hidden = true;
    ticker.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).not.toHaveBeenCalled();

    state.hidden = false;
    ticker.visibilityChanged();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tick).toHaveBeenCalledTimes(1);
    ticker.stop();
  });

  it("pauses while the tab is hidden and resumes when it is shown", async () => {
    const { state, tick, ticker } = setUp();
    ticker.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tick).toHaveBeenCalledTimes(1);

    state.hidden = true;
    ticker.visibilityChanged();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tick).toHaveBeenCalledTimes(1);

    state.hidden = false;
    ticker.visibilityChanged();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tick).toHaveBeenCalledTimes(2);
    ticker.stop();
  });

  it("aborts a request in flight when the tab is hidden, and does not schedule another", async () => {
    const signals: AbortSignal[] = [];
    const tick = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<TickOutcome>((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted"))),
      );
    });
    let hidden = false;
    const ticker = createDemoTicker({
      tick,
      isHidden: () => hidden,
      intervalMs: 12_000,
      jitterMs: 0,
      startDelayMs: 0,
    });
    ticker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(signals[0]!.aborted).toBe(false);

    hidden = true;
    ticker.visibilityChanged();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(signals[0]!.aborted).toBe(true);
    expect(tick).toHaveBeenCalledTimes(1);
    ticker.stop();
  });

  it("stops for good on stop(), aborting a request in flight", async () => {
    const { signals, tick, ticker } = setUp();
    ticker.start();
    await vi.advanceTimersByTimeAsync(1_000);
    ticker.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tick).toHaveBeenCalledTimes(1);

    // A tab shown after stop() must not revive it (the component has unmounted).
    ticker.visibilityChanged();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(signals).toHaveLength(1);
  });

  it("stops when the server says asking is pointless (demo off, signed out, not the demo org)", async () => {
    const { state, tick, ticker } = setUp();
    state.outcome = "stop";
    ticker.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(tick).toHaveBeenCalledTimes(1);

    ticker.visibilityChanged();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("keeps going after a failed request", async () => {
    const tick = vi
      .fn<(signal: AbortSignal) => Promise<TickOutcome>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue("continue");
    const ticker = createDemoTicker({
      tick,
      isHidden: () => false,
      intervalMs: 12_000,
      jitterMs: 0,
      startDelayMs: 0,
    });
    ticker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(12_000);
    expect(tick).toHaveBeenCalledTimes(2);
    ticker.stop();
  });
});
