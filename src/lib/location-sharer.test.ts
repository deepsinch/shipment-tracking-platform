import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PERMISSION_DENIED_NOTICE,
  startLocationSharing,
  UNAVAILABLE_PROBLEM,
  UNREACHABLE_PROBLEM,
  type Fix,
  type SendOutcome,
  type SharingState,
} from "./location-sharer";

const INTERVAL = 10_000;

/** A Geolocation stand-in that lets the test deliver positions and errors. */
function fakeGeolocation() {
  let success: PositionCallback | undefined;
  let failure: PositionErrorCallback | null | undefined;
  const geolocation = {
    watchPosition: vi.fn((onSuccess: PositionCallback, onError?: PositionErrorCallback | null) => {
      success = onSuccess;
      failure = onError;
      return 7;
    }),
    clearWatch: vi.fn(),
  };
  return {
    geolocation,
    position(lat: number, timestamp = Date.now()) {
      success!({
        coords: { latitude: lat, longitude: 4.48, accuracy: 9 },
        timestamp,
      } as GeolocationPosition);
    },
    error(code: 1 | 2 | 3) {
      failure!({
        code,
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    },
  };
}

describe("startLocationSharing", () => {
  let gps: ReturnType<typeof fakeGeolocation>;
  let sent: Fix[];
  let states: SharingState[];
  let reply: () => Promise<SendOutcome>;
  const start = (extra: { onServerStop?: () => void } = {}) =>
    startLocationSharing({
      geolocation: gps.geolocation,
      send: async (fix) => {
        sent.push(fix);
        return reply();
      },
      onChange: (state) => states.push(state),
      intervalMs: INTERVAL,
      ...extra,
    });
  const lastState = () => states.at(-1);

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-31T12:00:00Z") });
    gps = fakeGeolocation();
    sent = [];
    states = [];
    reply = async () => ({ status: "sent" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts locating, then sends the first fix straight away", async () => {
    start();
    expect(lastState()).toEqual({ mode: "locating" });

    gps.position(51.9, Date.parse("2026-10-31T11:59:58Z"));
    await vi.advanceTimersByTimeAsync(0);

    expect(sent).toEqual([
      {
        lat: 51.9,
        lng: 4.48,
        accuracyM: 9,
        recordedAt: new Date("2026-10-31T11:59:58Z"),
      },
    ]);
    expect(lastState()).toEqual({ mode: "sharing", lastSentAt: Date.now() });
  });

  it("sends at most once per interval, always the newest fix", async () => {
    start();
    gps.position(51.0);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(3_000);
    gps.position(51.1);
    await vi.advanceTimersByTimeAsync(3_000);
    gps.position(51.2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(sent.map((fix) => fix.lat)).toEqual([51.0]);

    await vi.advanceTimersByTimeAsync(1);
    expect(sent.map((fix) => fix.lat)).toEqual([51.0, 51.2]);
  });

  it("sends nothing when no new fix arrived", async () => {
    start();
    gps.position(51.0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(sent).toHaveLength(1);
  });

  it("stops watching on stop, and ignores anything still in flight", async () => {
    const sharing = start();
    gps.position(51.0);
    await vi.advanceTimersByTimeAsync(0);
    gps.position(51.1);

    sharing.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(gps.geolocation.clearWatch).toHaveBeenCalledWith(7);
    expect(sent).toHaveLength(1);
  });

  it("turns off with a notice when permission is denied", async () => {
    start();
    gps.error(1);

    expect(lastState()).toEqual({ mode: "off", notice: PERMISSION_DENIED_NOTICE });
    expect(gps.geolocation.clearWatch).toHaveBeenCalledWith(7);
  });

  it("keeps trying when the position is unavailable, and clears the problem on the next fix", async () => {
    start();
    gps.error(2);
    expect(lastState()).toEqual({
      mode: "sharing",
      lastSentAt: null,
      problem: UNAVAILABLE_PROBLEM,
    });
    expect(gps.geolocation.clearWatch).not.toHaveBeenCalled();

    gps.position(51.0);
    await vi.advanceTimersByTimeAsync(0);
    expect(lastState()).toEqual({ mode: "sharing", lastSentAt: Date.now() });
  });

  it("stops for good when the server says so", async () => {
    const onServerStop = vi.fn();
    reply = async () => ({ status: "stopped", message: "No longer on the road.", refresh: true });
    start({ onServerStop });

    gps.position(51.0);
    await vi.advanceTimersByTimeAsync(0);
    gps.position(51.1);
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(lastState()).toEqual({ mode: "off", notice: "No longer on the road." });
    expect(onServerStop).toHaveBeenCalledOnce();
    expect(gps.geolocation.clearWatch).toHaveBeenCalledWith(7);
    expect(sent).toHaveLength(1);
  });

  it("shows a problem but keeps sharing when a ping fails or is rejected", async () => {
    reply = async () => {
      throw new Error("offline");
    };
    start();
    gps.position(51.0);
    await vi.advanceTimersByTimeAsync(0);
    expect(lastState()).toMatchObject({ mode: "sharing", problem: UNREACHABLE_PROBLEM });

    reply = async () => ({ status: "rejected", message: "Check your clock." });
    gps.position(51.1);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(lastState()).toMatchObject({ mode: "sharing", problem: "Check your clock." });

    reply = async () => ({ status: "sent" });
    gps.position(51.2);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(lastState()).toEqual({ mode: "sharing", lastSentAt: Date.now() });
    expect(sent).toHaveLength(3);
  });

  it("treats a throttled ping as harmless", async () => {
    reply = async () => ({ status: "throttled" });
    start();
    gps.position(51.0);
    await vi.advanceTimersByTimeAsync(0);

    expect(lastState()).toEqual({ mode: "sharing", lastSentAt: null });
  });
});
