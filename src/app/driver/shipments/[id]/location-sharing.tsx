"use client";

import { LoaderCircleIcon, LocateOffIcon, TriangleAlertIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import { sendLocationPingAction } from "@/app/driver/actions";
import { Switch } from "@/components/ui/switch";
import { PING_INTERVAL_MS } from "@/domain/location-sharing";
import { formatElapsed } from "@/lib/format";
import {
  createSimulatedPositionSource,
  startLocationSharing,
  type SharingState,
} from "@/lib/location-sharer";
import { cn } from "@/lib/utils";

const noSubscription = () => () => {};

/**
 * "Share my location" for a shipment on the road. Off until the driver switches it on: the browser
 * asks for permission on that gesture, never on page load. While on, `startLocationSharing` watches
 * the position and sends the newest fix at most every `PING_INTERVAL_MS`.
 *
 * Sharing stops when the driver switches it off, when they leave the page (unmount, or Next hiding
 * the route: the layout effect cleanup runs either way, and the switch is off on return), when the
 * page re-renders without this component because the shipment is no longer on the road, and when
 * the server says to stop.
 *
 * The status line ticks every second, so it is not a live region (it would chatter): the switch
 * points to it with `aria-describedby`, and a separate polite live region announces changes of
 * state only.
 *
 * On the public demo (`demo`), real geolocation is never requested: no `navigator.geolocation`
 * call, so no permission prompt. The control works as usual, but the beat comes from a simulated
 * source and only the shipment id is sent; the server shares a simulated position along the
 * route, and the copy says so. See `recordDriverLocation`.
 */
export function LocationSharing({ shipmentId, demo }: { shipmentId: string; demo: boolean }) {
  const router = useRouter();
  const switchId = useId();
  const statusId = useId();
  const geolocationSupported = useSyncExternalStore(
    noSubscription,
    () => "geolocation" in navigator,
    // Assume support while rendering on the server, so supported devices see no flash.
    () => true,
  );
  // The demo needs no device support: it never uses the device's position.
  const supported = demo || geolocationSupported;
  const [state, setState] = useState<SharingState>({ mode: "off" });
  const sharing = useRef<{ stop: () => void } | null>(null);
  const now = useNow(state.mode === "sharing");

  // Leaving the page always stops sharing; it only ever restarts from the driver's own gesture.
  useLayoutEffect(() => {
    return () => {
      sharing.current?.stop();
      sharing.current = null;
      setState({ mode: "off" });
    };
  }, []);

  function onCheckedChange(checked: boolean) {
    sharing.current?.stop();
    sharing.current = null;
    if (!checked) {
      setState({ mode: "off" });
      return;
    }
    sharing.current = startLocationSharing({
      // In the demo `navigator.geolocation` is not even read.
      geolocation: demo
        ? createSimulatedPositionSource({ beatMs: PING_INTERVAL_MS / 2 })
        : navigator.geolocation,
      // The demo sends the shipment id alone: no coordinates leave the browser.
      send: demo
        ? () => sendLocationPingAction({ shipmentId })
        : (fix) => sendLocationPingAction({ shipmentId, ...fix }),
      onChange: setState,
      // Someone changed the shipment elsewhere: show its current status.
      onServerStop: (outcome) => outcome.refresh && router.refresh(),
      intervalMs: PING_INTERVAL_MS,
    });
  }

  const status = describe(state, supported, now, demo);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <label htmlFor={switchId} className="flex min-h-11 flex-1 cursor-pointer flex-col gap-1">
          <span className="text-base font-medium">Share my location</span>
          <span className="text-sm text-muted-foreground">
            Dispatch sees where this shipment is while it is on the road. Customers never see your
            location.
          </span>
          {demo && (
            <span data-testid="demo-location-note" className="text-sm font-medium">
              {DEMO_LOCATION_NOTE}
            </span>
          )}
        </label>
        <Switch
          id={switchId}
          checked={state.mode !== "off"}
          onCheckedChange={onCheckedChange}
          disabled={!supported}
          aria-describedby={statusId}
          className="mt-0.5 data-[size=default]:h-7 data-[size=default]:w-12 *:data-[slot=switch-thumb]:size-6! data-unchecked:bg-muted-foreground/80"
        />
      </div>
      <p
        id={statusId}
        data-testid="location-status"
        className={cn(
          "flex items-start gap-2 text-sm",
          status.tone === "active" && "font-medium text-emerald-700 dark:text-emerald-400",
          status.tone === "warning" && "font-medium text-amber-700 dark:text-amber-400",
          (status.tone === "muted" || status.tone === "pending") && "text-muted-foreground",
        )}
      >
        <StatusIcon tone={status.tone} />
        <span>{status.text}</span>
      </p>
      <p role="status" className="sr-only">
        {status.announcement}
      </p>
    </div>
  );
}

/** Shown in demo mode, where the shared position is simulated. */
const DEMO_LOCATION_NOTE =
  "Demo: a simulated position along the route is shared. Your real location is never used.";

type Tone = "active" | "pending" | "muted" | "warning";

function describe(
  state: SharingState,
  supported: boolean,
  now: number,
  demo: boolean,
): { text: string; tone: Tone; announcement: string } {
  if (!supported) {
    const text = "Location sharing is not available in this browser.";
    return { text, tone: "muted", announcement: text };
  }
  switch (state.mode) {
    case "off":
      return state.notice
        ? { text: state.notice, tone: "warning", announcement: state.notice }
        : { text: "Not sharing your location.", tone: "muted", announcement: "" };
    case "locating":
      return demo
        ? {
            text: "Preparing a simulated position…",
            tone: "pending",
            announcement: "Preparing a simulated position",
          }
        : {
            text: "Finding your location…",
            tone: "pending",
            announcement: "Finding your location",
          };
    case "sharing": {
      if (state.problem) {
        return { text: state.problem, tone: "warning", announcement: state.problem };
      }
      const sent =
        state.lastSentAt === null
          ? "sending…"
          : `last sent ${formatElapsed(now - state.lastSentAt)}`;
      // Announce that sharing is on, not every tick of the counter.
      const what = demo ? "Sharing simulated location" : "Sharing location";
      return { text: `${what} · ${sent}`, tone: "active", announcement: what };
    }
  }
}

function StatusIcon({ tone }: { tone: Tone }) {
  switch (tone) {
    case "active":
      return (
        <span className="relative mt-1 flex size-3 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-3 rounded-full bg-emerald-600" />
        </span>
      );
    case "pending":
      return (
        <LoaderCircleIcon
          className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      );
    case "warning":
      return <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />;
    case "muted":
      return <LocateOffIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />;
  }
}

/** The current time, re-read every second while `ticking`, for "last sent 12 s ago". */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}
