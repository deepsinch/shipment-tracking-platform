import { shipmentStatusLabel, type ShipmentStatus } from "./shipment-status";

/**
 * Kinds of rows in the append-only shipment history.
 *
 * - `created`: the shipment was booked (to_status = created).
 * - `status_changed`: a state machine transition (from_status -> to_status).
 * - `driver_assigned`: the assigned driver changed (assigned, reassigned or unassigned); the old
 *   and new driver ids are in `metadata` (see `DriverAssignment`). Internal only.
 *
 * Later phases add kinds such as proof of delivery.
 */
export const SHIPMENT_EVENT_TYPES = ["created", "status_changed", "driver_assigned"] as const;

export type ShipmentEventType = (typeof SHIPMENT_EVENT_TYPES)[number];

/**
 * The event types a customer may see on the public tracking page. An allow-list, so every new
 * event type stays internal until someone deliberately adds it here.
 */
export const PUBLIC_SHIPMENT_EVENT_TYPES = [
  "created",
  "status_changed",
] as const satisfies readonly ShipmentEventType[];

export type PublicShipmentEventType = (typeof PUBLIC_SHIPMENT_EVENT_TYPES)[number];

/** `metadata` of a `driver_assigned` event. Null means "no driver". */
export type DriverAssignment = { fromDriverId: string | null; toDriverId: string | null };

/** Reads a `driver_assigned` event's metadata; anything unexpected reads as "no driver". */
export function driverAssignmentOf(metadata: Record<string, unknown>): DriverAssignment {
  const idOrNull = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    fromDriverId: idOrNull(metadata.fromDriverId),
    toDriverId: idOrNull(metadata.toDriverId),
  };
}

/**
 * Headline for a history event: "Shipment created", or the status it entered. Driver assignments
 * read better with names, see `driverAssignmentTitle`.
 */
export function shipmentEventTitle(type: ShipmentEventType, status: ShipmentStatus | null): string {
  switch (type) {
    case "created":
      return "Shipment created";
    case "status_changed":
      return status ? shipmentStatusLabel(status) : "Status changed";
    case "driver_assigned":
      return "Driver changed";
  }
}

/** Headline for a driver assignment, given the drivers' names (null when there was none). */
export function driverAssignmentTitle(from: string | null, to: string | null): string {
  if (from && to) return `Reassigned from ${from} to ${to}`;
  if (to) return `Assigned to ${to}`;
  if (from) return `Unassigned from ${from}`;
  return "Driver changed";
}
