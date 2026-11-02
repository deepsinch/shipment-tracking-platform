export type RefreshScheduler = {
  /** Something changed: refresh soon. Requests within the debounce window share one refresh. */
  request(): void;
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

  const setDeferred = (next: boolean) => {
    if (next === deferred) return;
    deferred = next;
    onDeferredChange(next);
  };

  const ownWindowOpen = () => inFlight || graceTimer !== undefined;

  const endWindow = () => {
    graceTimer = undefined;
    if (!queued) return;
    queued = false;
    if (isBlocked()) setDeferred(true);
    else refresh();
  };

  const fire = () => {
    timer = undefined;
    if (ownWindowOpen()) {
      queued = true;
      return;
    }
    if (isBlocked()) setDeferred(true);
    else refresh();
  };

  return {
    request() {
      if (ownWindowOpen()) {
        queued = true;
        return;
      }
      timer ??= setTimeout(fire, debounceMs);
    },
    release() {
      if (!deferred || isBlocked()) return;
      setDeferred(false);
      refresh();
    },
    dismiss() {
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
      if (deferred && !isBlocked()) {
        setDeferred(false);
        refresh();
      }
    },
    refreshNow() {
      queued = false;
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
