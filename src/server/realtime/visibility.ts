import { seesAllOrganizationShipments } from "@/domain/shipment-permissions";
import type { RealtimeClientEvent } from "@/lib/realtime-events";
import type { AuthContext } from "@/server/auth/auth-context";

import type { RealtimeMessage } from "./messages";

/**
 * Who may receive a realtime message: the same scope as `visibleShipments(ctx)`, decided from
 * the message alone because the stream must not query the database for every message.
 *
 * - Never another organization's message.
 * - Admins and dispatchers: every message of their organization.
 * - Drivers: messages about shipments assigned to them, plus the change that took a shipment away
 *   from them (`previousDriverId`), so their list drops it.
 */
export function isVisibleTo(viewer: AuthContext, message: RealtimeMessage): boolean {
  if (message.organizationId !== viewer.organizationId) return false;
  if (seesAllOrganizationShipments(viewer.role)) return true;
  if (message.assignedDriverId === viewer.userId) return true;
  return message.kind === "shipment_changed" && message.previousDriverId === viewer.userId;
}

/**
 * The browser's view of a message: an explicit projection, so organization and user ids (and any
 * field added to messages later) never reach a client by accident.
 */
export function toClientEvent(message: RealtimeMessage): RealtimeClientEvent {
  switch (message.kind) {
    case "shipment_changed":
      return { kind: message.kind, shipmentId: message.shipmentId, reason: message.reason };
    case "position":
      return {
        kind: message.kind,
        shipmentId: message.shipmentId,
        lat: message.lat,
        lng: message.lng,
        recordedAt: message.recordedAt,
      };
  }
}
