import "server-only";

import type { Transaction } from "@/server/db/client";
import type { Shipment } from "@/server/db/schema";
import { getRealtimeBus } from "@/server/realtime";
import type { ShipmentChangeReason } from "@/server/realtime/messages";

/**
 * Realtime announcements from services. Each is called inside the transaction that made the
 * change, so it is delivered only if that transaction commits (see `RealtimeBus.publish`).
 */

/** Announces that a shipment was created, changed status or changed driver. */
export function announceShipmentChange(
  tx: Transaction,
  shipment: Pick<Shipment, "id" | "organizationId" | "assignedDriverId">,
  reason: ShipmentChangeReason,
  /** For a reassignment or unassignment: the driver who lost the shipment. */
  previousDriverId: string | null = null,
): Promise<void> {
  return getRealtimeBus().publish(tx, {
    kind: "shipment_changed",
    organizationId: shipment.organizationId,
    shipmentId: shipment.id,
    assignedDriverId: shipment.assignedDriverId,
    previousDriverId,
    reason,
  });
}

/** Announces a shipment's new latest position, reported by its assigned driver. */
export function announcePosition(
  tx: Transaction,
  position: {
    organizationId: string;
    shipmentId: string;
    driverId: string;
    lat: number;
    lng: number;
    recordedAt: Date;
  },
): Promise<void> {
  return getRealtimeBus().publish(tx, {
    kind: "position",
    organizationId: position.organizationId,
    shipmentId: position.shipmentId,
    assignedDriverId: position.driverId,
    lat: position.lat,
    lng: position.lng,
    recordedAt: position.recordedAt.toISOString(),
  });
}
