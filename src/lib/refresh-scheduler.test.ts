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

  it("shows no notice for the echo of the user's own submit, even while the form holds the submitted values", () => {
    blocked = true; // the form still holds what was just submitted
    scheduler.submitStarted();
    scheduler.request(); // own write's shipment_changed
    vi.advanceTimersByTime(300);
    expect(deferrals).toEqual([]);

    blocked = false; // the form remounted clean
    scheduler.submitSettled();
    vi.advanceTimersByTime(3_000);
    expect(deferrals).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("covers an event arriving shortly after the submission settled, with at most one refresh", () => {
    scheduler.submitStarted();
    scheduler.submitSettled();
    vi.advanceTimersByTime(1_000);
    for (let i = 0; i < 5; i++) scheduler.request();
    vi.advanceTimersByTime(300);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(deferrals).toEqual([]);
  });

  it("settles a submission that never remounts after the safety cap", () => {
    scheduler.submitStarted();
    scheduler.request();
    vi.advanceTimersByTime(10_000 + 3_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows the notice when another user's change arrives while the user is typing", () => {
    blocked = true;
    scheduler.request();
    vi.advanceTimersByTime(300);
    expect(deferrals).toEqual([true]);
  });

  it("shows the notice after the window if genuinely edited input still blocks", () => {
    scheduler.submitStarted();
    scheduler.request();
    scheduler.submitSettled();
    blocked = true; // the user typed in the fresh form meanwhile
    vi.advanceTimersByTime(3_000);
    expect(refresh).not.toHaveBeenCalled();
    expect(deferrals).toEqual([true]);
  });

  it("clears the notice when the form becomes clean without typing", () => {
    blocked = true;
    scheduler.request();
    vi.advanceTimersByTime(300);
    expect(deferrals).toEqual([true]);

    scheduler.recheck();
    expect(deferrals).toEqual([true]);

    blocked = false; // form remounted
    scheduler.recheck();
    expect(deferrals).toEqual([true, false]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never shows the notice for a resync alone: it waits for the input to go, then refreshes", () => {
    blocked = true;
    scheduler.request("resync"); // the stream's first resync, right after page load
    vi.advanceTimersByTime(300);
    expect(deferrals).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();

    scheduler.recheck();
    expect(refresh).not.toHaveBeenCalled(); // still typing

    blocked = false;
    scheduler.recheck();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(deferrals).toEqual([]);
  });

  it("refreshes a resync immediately when nothing blocks it", () => {
    scheduler.request("resync");
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("drops a quiet wait on submit: the action's own revalidation is fresher", () => {
    blocked = true;
    scheduler.request("resync");
    vi.advanceTimersByTime(300);
    scheduler.dismiss();
    blocked = false;
    scheduler.recheck();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows the notice when a real change joins or follows a resync", () => {
    blocked = true;
    scheduler.request("resync");
    scheduler.request("change");
    vi.advanceTimersByTime(300);
    expect(deferrals).toEqual([true]);

    scheduler.dismiss();
    scheduler.request("resync");
    vi.advanceTimersByTime(300);
    expect(deferrals).toEqual([true, false]); // quiet again: no new notice

    scheduler.request("change"); // a change after a quiet wait
    vi.advanceTimersByTime(300);
    expect(deferrals).toEqual([true, false, true]);
  });

  it("does not show the notice for a resync queued during an own submission", () => {
    scheduler.submitStarted();
    scheduler.request("resync");
    scheduler.submitSettled();
    blocked = true; // the user already typed in the fresh form
    vi.advanceTimersByTime(3_000);
    expect(deferrals).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cancels a pending refresh when disposed", () => {
    scheduler.request();
    scheduler.dispose();
    vi.advanceTimersByTime(1_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
