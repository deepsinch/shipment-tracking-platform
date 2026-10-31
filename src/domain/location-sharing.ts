import type { Role } from "./roles";
import type { ShipmentStatus } from "./shipment-status";

/**
 * Rules for live location from the driver app. Pure, shared by the driver UI (when to offer
 * "Share my location") and `recordLocationPing` (what to accept).
 * See docs/architecture.md, "Location telemetry is not history".
 */

/** The statuses in which the shipment is physically on the road with its driver. */
export const LOCATION_SHARING_STATUSES = [
  "picked_up",
  "in_transit",
  "out_for_delivery",
] as const satisfies readonly ShipmentStatus[];

/**
 * Whether pings are accepted for a shipment in `status`. Not before pickup (the driver is not
 * carrying it yet), not during an exception (the shipment may be parked at a depot), and never
 * once it is finished.
 */
export function isLocationSharingStatus(status: ShipmentStatus): boolean {
  return (LOCATION_SHARING_STATUSES as readonly ShipmentStatus[]).includes(status);
}

/** Only drivers report positions, and only for their own assignments (scope is the service's). */
export function canRecordLocation(role: Role): boolean {
  return role === "driver";
}

/** At most one accepted ping per shipment in this window; the client sends no faster either. */
export const PING_INTERVAL_MS = 10_000;
