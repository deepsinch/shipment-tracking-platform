import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRefreshScheduler } from "./refresh-scheduler";

describe("createRefreshScheduler", () => {
  let refresh: ReturnType<typeof vi.fn<() => void>>;
  let blocked: boolean;
  let deferrals: boolean[];
  let scheduler: ReturnType<typeof createRefreshScheduler>;

  beforeEach(() => {
    vi.useFakeTimers();
    refresh = vi.fn<() => void>();
    blocked = false;
    deferrals = [];
    scheduler = createRefreshScheduler({
      refresh,
      isBlocked: () => blocked,
      onDeferredChange: (deferred) => deferrals.push(deferred),
      debounceMs: 300,
    });
  });

  afterEach(() => {
    scheduler.dispose();
    vi.useRealTimers();
  });

  it("coalesces a burst into one refresh", () => {
    for (let i = 0; i < 10; i++) scheduler.request();
    vi.advanceTimersByTime(299);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps refreshing during a steady stream instead of waiting for quiet", () => {
    for (let ms = 0; ms < 1_000; ms += 50) {
      scheduler.request();
      vi.advanceTimersByTime(50);
    }
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("defers while the user has unsaved input, and refreshes once it is gone", () => {
    blocked = true;
    scheduler.request();
    vi.advanceTimersByTime(300);
    expect(refresh).not.toHaveBeenCalled();
    expect(deferrals).toEqual([true]);

    scheduler.release();
    expect(refresh).not.toHaveBeenCalled();

    blocked = false;
    scheduler.release();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(deferrals).toEqual([true, false]);

    // Nothing pending any more.
    scheduler.release();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes on demand, discarding the deferral", () => {
    blocked = true;
    scheduler.request();
    vi.advanceTimersByTime(300);

    scheduler.refreshNow();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(deferrals).toEqual([true, false]);
  });

  it("drops the deferral on submit without refreshing", () => {
    blocked = true;
    scheduler.request();
    vi.advanceTimersByTime(300);

    scheduler.dismiss();
    blocked = false;
    scheduler.release();
    expect(refresh).not.toHaveBeenCalled();
    expect(deferrals).toEqual([true, false]);
  });

  it("cancels a pending refresh when disposed", () => {
    scheduler.request();
    scheduler.dispose();
    vi.advanceTimersByTime(1_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
