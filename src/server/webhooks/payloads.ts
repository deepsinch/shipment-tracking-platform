import type { WebhookEventType } from "@/domain/webhooks";
import { toApiShipment } from "@/server/api/projections";
import type { Shipment, ShipmentEvent } from "@/server/db/schema";

/**
 * What a webhook delivery carries, as explicit projections like the API's (and built on them):
 * every field is copied by name, so a new column stays out of webhooks until someone adds it here,
 * to `docs/api.md` and to the key-set test. No internal ids are sent: the shipment id is the only
 * id (plus the event id, which exists for deduplication). Internal notes never leave: a webhook
 * often feeds a chat tool or a third party, and "internal" means inside the company.
 */

export type WebhookEnvelope<Data> = {
  /** The event id, shared by every delivery and resend of this event. Receivers deduplicate on it. */
  id: string;
  type: WebhookEventType;
  /** When the event was recorded (ISO 8601, UTC). */
  createdAt: string;
  data: Data;
};

export function envelope<Data>(
  eventId: string,
  type: WebhookEventType,
  createdAt: Date,
  data: Data,
): WebhookEnvelope<Data> {
  return { id: eventId, type, createdAt: createdAt.toISOString(), data };
}

/** The shipment as the API shows it, plus its `version` so receivers can ignore out-of-order deliveries. */
function shipmentData(shipment: Shipment) {
  return { shipment: toApiShipment(shipment), version: shipment.version };
}

export function toShipmentCreatedData(shipment: Shipment) {
  return shipmentData(shipment);
}

export type StatusChangeEvent = Pick<
  ShipmentEvent,
  | "fromStatus"
  | "toStatus"
  | "occurredAt"
  | "locationCity"
  | "locationLat"
  | "locationLng"
  | "publicNote"
>;

export function toStatusChangedData(shipment: Shipment, event: StatusChangeEvent) {
  const hasLocation =
    event.locationCity !== null || event.locationLat !== null || event.locationLng !== null;
  return {
    ...shipmentData(shipment),
    change: {
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      occurredAt: event.occurredAt.toISOString(),
      location: hasLocation
        ? { city: event.locationCity, lat: event.locationLat, lng: event.locationLng }
        : null,
      publicNote: event.publicNote,
    },
  };
}

export type DriverNames = { fromName: string | null; toName: string | null };

/** Drivers are identified by display name only; their user ids are internal. */
export function toDriverAssignedData(shipment: Shipment, names: DriverNames) {
  return {
    ...shipmentData(shipment),
    assignment: { fromDriverName: names.fromName, toDriverName: names.toName },
  };
}
