import { shipmentStatusLabel, type ShipmentStatus } from "./shipment-status";

/**
 * Wording and focus for the driver app. Pure, so the copy is unit tested and shared by the list
 * and the shipment view.
 */

/** Where the driver goes next: the pickup before collection, the delivery after, none when done. */
export type NextStop = "pickup" | "delivery";

const NEXT_STOP: Readonly<Record<ShipmentStatus, NextStop | null>> = {
  created: "pickup",
  picked_up: "delivery",
  in_transit: "delivery",
  out_for_delivery: "delivery",
  // Every way out of an exception (in transit, out for delivery) heads for the delivery.
  exception: "delivery",
  delivered: null,
  cancelled: null,
};

export function nextStopFor(status: ShipmentStatus): NextStop | null {
  return NEXT_STOP[status];
}

/** The button text for moving a shipment into `status`, phrased as what the driver does. */
export function statusActionLabel(status: ShipmentStatus): string {
  return status === "exception"
    ? "Report a problem"
    : `Mark as ${shipmentStatusLabel(status).toLowerCase()}`;
}

/** Whether a shipment still on the road has missed its promised delivery time. */
export function isOverdue(
  shipment: { status: ShipmentStatus; promisedDeliveryAt: Date | null },
  now: Date,
): boolean {
  return (
    nextStopFor(shipment.status) !== null &&
    shipment.promisedDeliveryAt !== null &&
    shipment.promisedDeliveryAt < now
  );
}
