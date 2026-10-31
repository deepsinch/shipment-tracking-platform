"use client";

import { useState } from "react";

import { newerFix, type Fix } from "@/lib/live-positions";

import { useRealtime } from "./realtime-provider";

/** A shipment's latest known position; `recordedAt` is the device time, ISO 8601. */
export type LivePosition = Fix;

/**
 * The shipment's position, starting from the server-rendered snapshot (`initial`, from
 * `getShipmentPositions`) and moved by realtime `position` events. Whichever is newer wins, so a
 * refreshed snapshot and a live event can arrive in either order.
 */
export function useLivePosition(
  shipmentId: string,
  initial: LivePosition | null,
): LivePosition | null {
  const [live, setLive] = useState<LivePosition | null>(null);

  useRealtime((event) => {
    if (event.kind !== "position" || event.shipmentId !== shipmentId) return;
    const position = { lat: event.lat, lng: event.lng, recordedAt: event.recordedAt };
    setLive((current) => newerFix(current, position));
  });

  return newerFix(initial, live);
}
