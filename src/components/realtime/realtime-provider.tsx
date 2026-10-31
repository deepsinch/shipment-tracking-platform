"use client";

import { createContext, useContext, useEffect, useEffectEvent, useState } from "react";

import { connectRealtime, type RealtimeStatus } from "@/lib/realtime-connection";
import type { RealtimeClientEvent } from "@/lib/realtime-events";

type Listener = (event: RealtimeClientEvent) => void;
type Subscribe = (listener: Listener) => () => void;

const StatusContext = createContext<RealtimeStatus | null>(null);
// Separate from the status, and stable, so listeners do not resubscribe on every status change.
const SubscribeContext = createContext<Subscribe | null>(null);

const REALTIME_URL = "/api/realtime";

/**
 * Owns the page's one realtime connection (`/api/realtime`). It sits in the dashboard and driver
 * layouts, which stay mounted across client navigations, so the stream survives moving between
 * pages and the browser holds one connection per tab however many components listen.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [listeners] = useState(() => new Set<Listener>());
  const [subscribe] = useState(() => {
    const add: Subscribe = (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };
    return add;
  });

  useEffect(
    () =>
      connectRealtime({
        url: REALTIME_URL,
        onStatus: setStatus,
        onEvent: (event) => {
          for (const listener of [...listeners]) listener(event);
        },
      }),
    [listeners],
  );

  return (
    <StatusContext value={status}>
      <SubscribeContext value={subscribe}>{children}</SubscribeContext>
    </StatusContext>
  );
}

/**
 * Calls `onEvent` for every realtime event while the component is mounted: `resync` (re-read
 * your data), `shipment_changed` and `position`. The server has already filtered events to what
 * the signed-in user may see. Outside a `RealtimeProvider` it does nothing.
 */
export function useRealtime(onEvent: Listener): void {
  const subscribe = useContext(SubscribeContext);
  const handle = useEffectEvent(onEvent);
  useEffect(() => subscribe?.((event) => handle(event)), [subscribe]);
}

/** The connection status, for the Live indicator. */
export function useRealtimeStatus(): RealtimeStatus {
  return useContext(StatusContext) ?? "connecting";
}
