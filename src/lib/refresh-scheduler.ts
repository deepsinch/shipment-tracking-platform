/** `change`: something is known to have changed. `resync`: the stream (re)connected; maybe not. */
export type RequestKind = "change" | "resync";

export type RefreshScheduler = {
  /**
   * Something changed: refresh soon. Requests within the debounce window share one refresh.
   * `"resync"` means a (re)connection, which says the page may be stale, not that it is: the
   * refresh still runs, but it never raises the notice (see `createRefreshScheduler`).
   */
  request(kind?: RequestKind): void;
  /** The user may have stopped editing (input cleared, form reset): run a deferred refresh. */
  release(): void;
  /** The user submitted: their action re-renders the page, so drop the deferred refresh. */
  dismiss(): void;
  /** The user asked for the latest data, accepting that unsaved input is lost. */
  refreshNow(): void;
  /**
   * This tab's own submission started. Its Server Action revalidates the page itself, so
   * realtime requests caused by it are already handled and never show the notice.
   */
  submitStarted(): void;
  /** The own submission finished (the form remounted). A grace period follows, for late events. */
  submitSettled(): void;
  /** The page changed (forms remounted): if nothing blocks any more, end a deferral. */
  recheck(): void;
  dispose(): void;
};

export type RefreshSchedulerOptions = {
  refresh: () => void;
  /** True while refreshing would wipe something the user typed. */
  isBlocked: () => boolean;
  /** Called when a refresh is deferred (true) or the deferral ends (false). */
  onDeferredChange: (deferred: boolean) => void;
  debounceMs?: number;
  /** How long after an own submission settles that realtime requests still count as its echo. */
  graceMs?: number;
  /** Safety cap: a submission that never settles (a validation error keeps the form) ends here. */
  maxInFlightMs?: number;
};

/**
 * Turns realtime invalidations into page refreshes without refresh storms or lost input.
 *
 * - A request starts a short window; every request inside it joins the same refresh. The window
 *   is not extended, so a steady stream of changes still refreshes about every `debounceMs`.
 * - When the window ends while the user has unsaved input (`isBlocked`), the refresh is deferred
 *   instead: a refresh would remount the version-keyed forms and wipe what they typed. The page
 *   shows a notice; the refresh runs once the input is gone, or when the user asks for it.
 * - Only a `change` raises that notice. A `resync` (every connection of the stream starts with
 *   one, including the page's first, a few hundred milliseconds after load) is not evidence that
 *   anything changed: when input blocks a refresh requested by resyncs alone, it waits silently
 *   and runs when the input is gone. Raising the notice there told users about updates that did
 *   not exist, and flaked `own-submit.spec.ts` whenever the first field was touched right after
 *   a page load.
 */
export function createRefreshScheduler({
  refresh,
  isBlocked,
  onDeferredChange,
  debounceMs = 300,
  graceMs = 3_000,
  maxInFlightMs = 10_000,
}: RefreshSchedulerOptions): RefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deferred = false;
  let inFlight = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let capTimer: ReturnType<typeof setTimeout> | undefined;
  /** A request arrived during the own-write window; at most one refresh is queued for its end. */
  let queued = false;
  /** A `change` (not just a `resync`) is part of the refresh being collected or deferred. */
  let changeSeen = false;
  /** Input blocked a refresh that only resyncs asked for: it runs when the input is gone. */
  let quietlyDeferred = false;

  const setDeferred = (next: boolean) => {
    if (next === deferred) return;
    deferred = next;
    onDeferredChange(next);
  };

  const ownWindowOpen = () => inFlight || graceTimer !== undefined;

  /** The collected requests are due: refresh, or wait for the input that blocks it. */
  const run = () => {
    if (isBlocked()) {
      if (changeSeen) setDeferred(true);
      else quietlyDeferred = true;
      return;
    }
    changeSeen = false;
    quietlyDeferred = false;
    refresh();
  };

  /** The input that blocked a deferred refresh is gone: end the deferral and refresh. */
  const settleDeferral = () => {
    changeSeen = false;
    quietlyDeferred = false;
    setDeferred(false);
    refresh();
  };

  const endWindow = () => {
    graceTimer = undefined;
    if (!queued) return;
    queued = false;
    run();
  };

  const fire = () => {
    timer = undefined;
    if (ownWindowOpen()) {
      queued = true;
      return;
    }
    run();
  };

  return {
    request(kind = "change") {
      if (kind === "change") {
        // A change turns a quiet wait into a regular request: the notice, if input still blocks.
        changeSeen = true;
        quietlyDeferred = false;
      }
      if (ownWindowOpen()) {
        queued = true;
        return;
      }
      timer ??= setTimeout(fire, debounceMs);
    },
    release() {
      if (!(deferred || quietlyDeferred) || isBlocked()) return;
      settleDeferral();
    },
    dismiss() {
      quietlyDeferred = false;
      changeSeen = false;
      setDeferred(false);
    },
    submitStarted() {
      inFlight = true;
      clearTimeout(graceTimer);
      graceTimer = undefined;
      clearTimeout(capTimer);
      capTimer = setTimeout(() => this.submitSettled(), maxInFlightMs);
      setDeferred(false);
    },
    submitSettled() {
      if (!inFlight) return;
      inFlight = false;
      clearTimeout(capTimer);
      capTimer = undefined;
      graceTimer = setTimeout(endWindow, graceMs);
    },
    recheck() {
      if ((deferred || quietlyDeferred) && !isBlocked()) settleDeferral();
    },
    refreshNow() {
      queued = false;
      changeSeen = false;
      quietlyDeferred = false;
      clearTimeout(timer);
      timer = undefined;
      setDeferred(false);
      refresh();
    },
    dispose() {
      clearTimeout(timer);
      clearTimeout(graceTimer);
      clearTimeout(capTimer);
      timer = undefined;
      graceTimer = undefined;
      capTimer = undefined;
    },
  };
}
