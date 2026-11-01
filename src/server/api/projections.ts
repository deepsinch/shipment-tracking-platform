import type { PublicTracking } from "@/server/services/public-tracking";
import type { ShipmentDetail, ShipmentEventWithActor } from "@/server/services/get-shipment";
import type { ShipmentListItem } from "@/server/services/list-shipments";
import type { Shipment } from "@/server/db/schema";

/**
 * What the public API returns, as explicit projections: each field is copied by name, so a new
 * column on `shipments` or `shipment_events` stays out of the API until someone adds it here and
 * to the OpenAPI document (a test compares the three). Internal ids are never returned: no
 * organization id, user id (creator, driver, actor) or event id. The shipment id is the only id.
 * Times are ISO 8601 in UTC.
 */

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date ? iso(date) : null);

export function toApiShipmentSummary(row: ShipmentListItem) {
  return {
    id: row.id,
    trackingCode: row.trackingCode,
    status: row.status,
    reference: row.reference,
    recipientName: row.recipientName,
    origin: { city: row.originCity, country: row.originCountry },
    destination: { city: row.destinationCity, country: row.destinationCountry },
    serviceLevel: row.serviceLevel,
    promisedDeliveryAt: isoOrNull(row.promisedDeliveryAt),
    createdAt: iso(row.createdAt),
  };
}

export type ApiShipmentSummary = ReturnType<typeof toApiShipmentSummary>;

/** The shipment itself, without its history or driver: the body of create and status responses. */
export function toApiShipment(shipment: Shipment) {
  return {
    id: shipment.id,
    trackingCode: shipment.trackingCode,
    status: shipment.status,
    reference: shipment.reference,
    recipient: { name: shipment.recipientName, email: shipment.recipientEmail },
    origin: {
      addressLine: shipment.originAddressLine,
      city: shipment.originCity,
      postalCode: shipment.originPostalCode,
      country: shipment.originCountry,
      lat: shipment.originLat,
      lng: shipment.originLng,
    },
    destination: {
      addressLine: shipment.destinationAddressLine,
      city: shipment.destinationCity,
      postalCode: shipment.destinationPostalCode,
      country: shipment.destinationCountry,
      lat: shipment.destinationLat,
      lng: shipment.destinationLng,
    },
    weightKg: shipment.weightKg,
    serviceLevel: shipment.serviceLevel,
    promisedDeliveryAt: isoOrNull(shipment.promisedDeliveryAt),
    createdAt: iso(shipment.createdAt),
    updatedAt: iso(shipment.updatedAt),
  };
}

export type ApiShipment = ReturnType<typeof toApiShipment>;

export function toApiEvent(event: ShipmentEventWithActor) {
  const hasLocation =
    event.locationCity !== null || event.locationLat !== null || event.locationLng !== null;
  return {
    type: event.type,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    occurredAt: iso(event.occurredAt),
    recordedAt: iso(event.recordedAt),
    location: hasLocation
      ? { city: event.locationCity, lat: event.locationLat, lng: event.locationLng }
      : null,
    publicNote: event.publicNote,
    internalNote: event.internalNote,
    assignment: event.assignment,
  };
}

export type ApiEvent = ReturnType<typeof toApiEvent>;

/** A shipment with its history, oldest event first. */
export function toApiShipmentDetail({ shipment, assignedDriverName, events }: ShipmentDetail) {
  return {
    ...toApiShipment(shipment),
    /** The driver's display name; their user id is internal. Null when unassigned. */
    driverName: assignedDriverName,
    events: events.map(toApiEvent),
  };
}

export type ApiShipmentDetail = ReturnType<typeof toApiShipmentDetail>;

/** The public tracking page's content: what anyone holding the tracking code may see. */
export function toApiTracking(tracking: PublicTracking) {
  return {
    trackingCode: tracking.trackingCode,
    status: tracking.status,
    origin: { city: tracking.origin.city, country: tracking.origin.country },
    destination: { city: tracking.destination.city, country: tracking.destination.country },
    promisedDeliveryAt: isoOrNull(tracking.promisedDeliveryAt),
    signedBy: tracking.signedBy,
    timeline: tracking.timeline.map((event) => ({
      type: event.type,
      status: event.status,
      occurredAt: iso(event.occurredAt),
      city: event.city,
      publicNote: event.publicNote,
    })),
  };
}

export type ApiTracking = ReturnType<typeof toApiTracking>;
