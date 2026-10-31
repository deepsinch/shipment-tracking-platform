import { shipmentStatusLabel, type ShipmentStatus } from "./shipment-status";

/**
 * Kinds of rows in the append-only shipment history.
 *
 * - `created`: the shipment was booked (to_status = created).
 * - `status_changed`: a state machine transition (from_status -> to_status).
 *
 * Later phases add kinds such as location pings and proof of delivery.
 */
export const SHIPMENT_EVENT_TYPES = ["created", "status_changed"] as const;

export type ShipmentEventType = (typeof SHIPMENT_EVENT_TYPES)[number];

/** Headline for a history event: "Shipment created", or the status it entered. */
export function shipmentEventTitle(type: ShipmentEventType, status: ShipmentStatus | null): string {
  if (type === "created") return "Shipment created";
  return status ? shipmentStatusLabel(status) : "Status changed";
}
