export type RefreshScheduler = {
  /** Something changed: refresh soon. Requests within the debounce window share one refresh. */
  request(): void;
  /** The user may have stopped editing (input cleared, form reset): run a deferred refresh. */
  release(): void;
  /** The user submitted: their action re-renders the page, so drop the deferred refresh. */
  dismiss(): void;
  /** The user asked for the latest data, accepting that unsaved input is lost. */
  refreshNow(): void;
  dispose(): void;
};

export type RefreshSchedulerOptions = {
  refresh: () => void;
  /** True while refreshing would wipe something the user typed. */
  isBlocked: () => boolean;
  /** Called when a refresh is deferred (true) or the deferral ends (false). */
  onDeferredChange: (deferred: boolean) => void;
  debounceMs?: number;
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
}: RefreshSchedulerOptions): RefreshScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deferred = false;

  const setDeferred = (next: boolean) => {
    if (next === deferred) return;
    deferred = next;
    onDeferredChange(next);
  };

  const fire = () => {
    timer = undefined;
    if (isBlocked()) setDeferred(true);
    else refresh();
  };

  return {
    request() {
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
    refreshNow() {
      clearTimeout(timer);
      timer = undefined;
      setDeferred(false);
      refresh();
    },
    dispose() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
