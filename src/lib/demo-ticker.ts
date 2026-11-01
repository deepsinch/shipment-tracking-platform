/**
 * The browser side of the hosted demo's simulator (`/api/demo/tick`): asks the server to move the
 * trucks while someone is looking. Framework-free so its timing is unit tested with fake timers.
 *
 * - One request at a time; the next is scheduled `intervalMs` plus a random share of `jitterMs`
 *   after the previous one finished (never sooner than the server's own interval, so most requests
 *   are not throttled, and viewers drift apart instead of firing together).
 * - A hidden tab does nothing: the timer is cleared, a request in flight is aborted, and the loop
 *   starts again shortly after the tab is shown.
 * - `stop` ends it for good, and so does a `"stop"` answer (not signed in, not part of the demo,
 *   demo mode off): asking again would not change anything.
 * - A failed request (offline, server error) is not fatal; the next one is simply scheduled.
 */

export type TickOutcome = "continue" | "stop";

export type DemoTickerOptions = {
  /** Performs one request. Throwing counts as a failed request, not as a reason to stop. */
  tick: (signal: AbortSignal) => Promise<TickOutcome>;
  isHidden: () => boolean;
  intervalMs: number;
  jitterMs: number;
  /** Wait before the first request of a visible tab, and after a tab is shown again. */
  startDelayMs?: number;
  random?: () => number;
};

export type DemoTicker = {
  start: () => void;
  /** Tell it the tab was hidden or shown (`visibilitychange`). */
  visibilityChanged: () => void;
  stop: () => void;
};

export function createDemoTicker(options: DemoTickerOptions): DemoTicker {
  const { tick, isHidden, intervalMs, jitterMs, startDelayMs = 1000 } = options;
  const random = options.random ?? Math.random;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  let stopped = true;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (delayMs: number) => {
    clearTimer();
    timer = setTimeout(run, delayMs);
  };

  async function run() {
    timer = null;
    if (stopped || isHidden()) return;
    const controller = new AbortController();
    inFlight = controller;
    let outcome: TickOutcome = "continue";
    try {
      outcome = await tick(controller.signal);
    } catch {
      // Aborted (tab hidden or stopped) or a failed request: decided below.
    }
    if (inFlight === controller) inFlight = null;
    if (controller.signal.aborted || stopped) return;
    if (outcome === "stop") {
      stopped = true;
      return;
    }
    if (!isHidden()) schedule(intervalMs + random() * jitterMs);
  }

  return {
    start() {
      stopped = false;
      if (!isHidden()) schedule(startDelayMs);
    },
    visibilityChanged() {
      if (stopped) return;
      if (isHidden()) {
        clearTimer();
        inFlight?.abort();
        inFlight = null;
      } else if (timer === null && inFlight === null) {
        schedule(startDelayMs);
      }
    },
    stop() {
      stopped = true;
      clearTimer();
      inFlight?.abort();
      inFlight = null;
    },
  };
}
