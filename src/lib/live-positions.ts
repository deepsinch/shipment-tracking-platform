import type { ShipmentStatus } from "@/domain/shipment-status";

import type { PositionEvent } from "./realtime-events";

/** A position fix; `recordedAt` is the device time, ISO 8601. */
export type Fix = { lat: number; lng: number; recordedAt: string };

/** What the live map knows about one shipment: the server snapshot's fields plus its latest fix. */
export type FleetShipment = Fix & {
  shipmentId: string;
  trackingCode: string;
  status: ShipmentStatus;
  destinationCity: string;
  destinationCountry: string;
};

/** Live fixes by shipment id, as received from the realtime stream since the page loaded. */
export type LiveFixes = ReadonlyMap<string, Fix>;

/**
 * The newer of two fixes by device time; on a tie, the first. A server snapshot and a live event
 * can arrive in either order (a refresh races the stream), and the newest fix must win either way.
 */
export function newerFix<T extends Fix>(current: T | null, candidate: T | null): T | null {
  if (!current || !candidate) return current ?? candidate;
  return Date.parse(candidate.recordedAt) > Date.parse(current.recordedAt) ? candidate : current;
}

/**
 * Records a realtime position event. Returns the same map when the event is not newer than what
 * is known, so React can skip the re-render.
 */
export function applyPositionEvent(fixes: LiveFixes, event: PositionEvent): LiveFixes {
  const fix: Fix = { lat: event.lat, lng: event.lng, recordedAt: event.recordedAt };
  const current = fixes.get(event.shipmentId) ?? null;
  if (newerFix(current, fix) === current) return fixes;
  return new Map(fixes).set(event.shipmentId, fix);
}

/**
 * The map's shipments: the server snapshot, each moved to its live fix where that is newer.
 *
 * The snapshot decides which shipments exist. A shipment that finished drops out of the next
 * snapshot, and live fixes for it are ignored; a fix for a shipment the snapshot does not have yet
 * waits until a re-fetched snapshot brings its tracking code and status (see `isUnknownShipment`).
 */
export function mergeFleet(snapshot: readonly FleetShipment[], fixes: LiveFixes): FleetShipment[] {
  return snapshot.map((shipment) => {
    const live = fixes.get(shipment.shipmentId);
    if (!live || newerFix<Fix>(shipment, live) !== live) return shipment;
    return { ...shipment, lat: live.lat, lng: live.lng, recordedAt: live.recordedAt };
  });
}

/**
 * True when a position event is for a shipment the snapshot does not have: its first ping. The
 * event carries no tracking code or status, so the page re-fetches the snapshot to show it.
 */
export function isUnknownShipment(
  snapshot: readonly FleetShipment[],
  event: PositionEvent,
): boolean {
  return !snapshot.some((shipment) => shipment.shipmentId === event.shipmentId);
}

/**
 * Order for the list beside the map: problems first, then by tracking code. Deliberately not by
 * freshness: a list that reshuffled on every ping would move links under the pointer and lose a
 * keyboard user's place.
 */
export function sortFleetForList(shipments: readonly FleetShipment[]): FleetShipment[] {
  const rank = (shipment: FleetShipment) => (shipment.status === "exception" ? 0 : 1);
  return [...shipments].sort(
    (a, b) => rank(a) - rank(b) || a.trackingCode.localeCompare(b.trackingCode),
  );
}
