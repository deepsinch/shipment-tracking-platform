/**
 * Shipment lifecycle as a finite state machine.
 *
 * This module is pure (no I/O) so it can be shared by the UI, which only offers
 * allowed next statuses, and by the server, which enforces them.
 * See docs/architecture.md, "Shipment lifecycle".
 */

export const SHIPMENT_STATUSES = [
  "created",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
  "cancelled",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

const TRANSITIONS: Readonly<Record<ShipmentStatus, readonly ShipmentStatus[]>> = {
  created: ["picked_up", "exception", "cancelled"],
  picked_up: ["in_transit", "exception"],
  in_transit: ["out_for_delivery", "exception"],
  out_for_delivery: ["delivered", "exception"],
  exception: ["in_transit", "out_for_delivery", "cancelled"],
  delivered: [],
  cancelled: [],
};

export const SHIPMENT_STATUS_LABELS: Readonly<Record<ShipmentStatus, string>> = {
  created: "Created",
  picked_up: "Picked up",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Exception",
  cancelled: "Cancelled",
};

export function isShipmentStatus(value: unknown): value is ShipmentStatus {
  return typeof value === "string" && (SHIPMENT_STATUSES as readonly string[]).includes(value);
}

export function allowedNextStatuses(from: ShipmentStatus): readonly ShipmentStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: ShipmentStatus, to: ShipmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isTerminalStatus(status: ShipmentStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function shipmentStatusLabel(status: ShipmentStatus): string {
  return SHIPMENT_STATUS_LABELS[status];
}
