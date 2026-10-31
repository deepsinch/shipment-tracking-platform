import type { ShipmentStatus } from "./shipment-status";

/**
 * Progress along the normal delivery path, for the customer's progress bar. Exceptions and
 * cancellations are not steps: an exception keeps the progress reached before it, and a cancelled
 * shipment has no progress to show.
 */
export const DELIVERY_STEPS = [
  "created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
] as const satisfies readonly ShipmentStatus[];

export type DeliveryStep = (typeof DELIVERY_STEPS)[number];

export type TrackingProgress = {
  /** Index into DELIVERY_STEPS of the last step reached. */
  stepIndex: number;
  /** `exception` and `cancelled` mean the shipment is off the normal path. */
  state: "on_track" | "exception" | "cancelled" | "delivered";
};

function stepIndexOf(status: ShipmentStatus | null): number {
  return DELIVERY_STEPS.indexOf(status as DeliveryStep);
}

/**
 * @param status the shipment's current status
 * @param history the statuses entered, oldest first (the public timeline)
 */
export function trackingProgress(
  status: ShipmentStatus,
  history: readonly (ShipmentStatus | null)[],
): TrackingProgress {
  // An exception can resume to a later step than it interrupted, so take the furthest step seen.
  const furthest = Math.max(0, ...history.map(stepIndexOf), stepIndexOf(status));
  switch (status) {
    case "delivered":
      return { stepIndex: DELIVERY_STEPS.length - 1, state: "delivered" };
    case "exception":
      return { stepIndex: furthest, state: "exception" };
    case "cancelled":
      return { stepIndex: furthest, state: "cancelled" };
    default:
      return { stepIndex: stepIndexOf(status), state: "on_track" };
  }
}
