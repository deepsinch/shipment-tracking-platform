/**
 * The browser side of live location: watches the device position and sends the latest fix at most
 * once per interval. Framework-free, with the Geolocation API, the sender and the clock injected,
 * so the timing rules are unit tested without a browser. The React component only renders `state`.
 */

/** A position as the server action takes it (without the shipment). */
export type Fix = { lat: number; lng: number; accuracyM: number; recordedAt: Date };

/** The server's answer to one ping (see `sendLocationPingAction`). */
export type SendOutcome =
  | { status: "sent" }
  | { status: "throttled" }
  | { status: "rejected"; message: string }
  | { status: "stopped"; message: string; refresh: boolean };

export type SharingState =
  /** Not sharing. `notice` says why it stopped, when it was not the driver's choice. */
  | { mode: "off"; notice?: string }
  /** Switched on, waiting for the first fix (and, the first time, the permission prompt). */
  | { mode: "locating" }
  /** Watching the position. `problem` is a recoverable issue worth showing. */
  | { mode: "sharing"; lastSentAt: number | null; problem?: string };

export type LocationSharerDeps = {
  geolocation: Pick<Geolocation, "watchPosition" | "clearWatch">;
  send: (fix: Fix) => Promise<SendOutcome>;
  onChange: (state: SharingState) => void;
  /** Called once when the server ends sharing (e.g. the shipment was delivered elsewhere). */
  onServerStop?: (outcome: Extract<SendOutcome, { status: "stopped" }>) => void;
  intervalMs: number;
  now?: () => number;
};

export const PERMISSION_DENIED_NOTICE =
  "Location access is blocked for this site. Allow it in your browser's site settings, then switch sharing on again.";
export const UNAVAILABLE_PROBLEM = "Your position is unavailable right now. Still trying…";
export const UNREACHABLE_PROBLEM = "Could not reach the server. Retrying…";

const WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  // A cached fix up to 5 s old is fine: we send at most every 10 s.
  maximumAge: 5_000,
  timeout: 30_000,
};

/**
 * Starts watching and sending; returns `stop`, which ends everything at once (callbacks still in
 * flight are ignored). A fix that arrives inside the interval waits for it, replaced by any newer
 * fix, so the server always gets the freshest position available when the window opens.
 */
export function startLocationSharing(deps: LocationSharerDeps): { stop: () => void } {
  const now = deps.now ?? Date.now;
  let state: SharingState = { mode: "locating" };
  let stopped = false;
  let pending: Fix | null = null;
  let inFlight = false;
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watchId: number | null = null;

  const update = (next: SharingState) => {
    state = next;
    deps.onChange(next);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (watchId !== null) deps.geolocation.clearWatch(watchId);
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  const flush = async () => {
    if (stopped || inFlight || !pending) return;
    const wait = lastAttemptAt + deps.intervalMs - now();
    if (wait > 0) {
      timer ??= setTimeout(() => {
        timer = null;
        void flush();
      }, wait);
      return;
    }

    const fix = pending;
    pending = null;
    inFlight = true;
    lastAttemptAt = now();
    try {
      const outcome = await deps.send(fix);
      if (stopped) return;
      if (outcome.status === "stopped") {
        stop();
        update({ mode: "off", notice: outcome.message });
        deps.onServerStop?.(outcome);
        return;
      }
      if (outcome.status === "sent") update({ mode: "sharing", lastSentAt: now() });
      if (outcome.status === "rejected" && state.mode === "sharing") {
        update({ ...state, problem: outcome.message });
      }
    } catch {
      if (!stopped && state.mode === "sharing") update({ ...state, problem: UNREACHABLE_PROBLEM });
    } finally {
      inFlight = false;
      // A newer fix may have arrived while this one was on its way.
      void flush();
    }
  };

  update(state);
  watchId = deps.geolocation.watchPosition(
    (position) => {
      if (stopped) return;
      pending = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM: position.coords.accuracy,
        recordedAt: new Date(position.timestamp),
      };
      if (state.mode !== "sharing") update({ mode: "sharing", lastSentAt: null });
      else if (state.problem === UNAVAILABLE_PROBLEM) update({ ...state, problem: undefined });
      void flush();
    },
    (error) => {
      if (stopped) return;
      if (error.code === error.PERMISSION_DENIED) {
        stop();
        update({ mode: "off", notice: PERMISSION_DENIED_NOTICE });
        return;
      }
      // Unavailable or timed out: the watch keeps trying, so say so and carry on.
      update(
        state.mode === "sharing"
          ? { ...state, problem: UNAVAILABLE_PROBLEM }
          : { mode: "sharing", lastSentAt: null, problem: UNAVAILABLE_PROBLEM },
      );
    },
    WATCH_OPTIONS,
  );
  // In case an implementation reported a denial synchronously, before the id was known.
  if (stopped) deps.geolocation.clearWatch(watchId);

  return { stop };
}
