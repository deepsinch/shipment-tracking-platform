import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { PUBLIC_SHIPMENT_EVENT_TYPES, type PublicShipmentEventType } from "@/domain/shipment-event";
import type { ShipmentStatus } from "@/domain/shipment-status";
import { normalizeTrackingCode } from "@/domain/tracking-code";
import { getDb } from "@/server/db/client";
import { deliveryProofs, shipmentEvents, shipments } from "@/server/db/schema";

/**
 * What anyone holding a tracking code may see. Built from an explicit column list (never
 * `select()` of a whole row), so a new column on `shipments` or `shipment_events` stays private
 * until someone deliberately adds it here. Recipient details, street addresses, internal notes,
 * drivers, actors and internal ids are never included. The timeline holds only customer-facing
 * event types (`PUBLIC_SHIPMENT_EVENT_TYPES`, an allow-list), so internal history such as driver
 * assignments never appears. See docs/architecture.md, "Public tracking page".
 */
export type PublicTracking = {
  trackingCode: string;
  status: ShipmentStatus;
  origin: { city: string; country: string };
  destination: { city: string; country: string };
  promisedDeliveryAt: Date | null;
  /**
   * The printed name of whoever signed for a delivered shipment, or null (not delivered, or
   * delivered without proof). Only the name: the signature and the photo are never public.
   */
  signedBy: string | null;
  timeline: PublicTrackingEvent[];
};

export type PublicTrackingEvent = {
  type: PublicShipmentEventType;
  /** The status the shipment entered with this event. */
  status: ShipmentStatus | null;
  occurredAt: Date;
  /** City-level only; exact coordinates are not public. */
  city: string | null;
  publicNote: string | null;
};

/**
 * Public tracking lookup, no authentication. Accepts the code as a person would type it (any case,
 * with or without dashes); returns null when it is not a valid code or no shipment has it.
 */
export async function getPublicTracking(code: string): Promise<PublicTracking | null> {
  const trackingCode = normalizeTrackingCode(code);
  if (!trackingCode) return null;

  const db = getDb();
  const [shipment] = await db
    .select({
      // Used only to load the timeline below; never returned.
      id: shipments.id,
      trackingCode: shipments.trackingCode,
      status: shipments.status,
      originCity: shipments.originCity,
      originCountry: shipments.originCountry,
      destinationCity: shipments.destinationCity,
      destinationCountry: shipments.destinationCountry,
      promisedDeliveryAt: shipments.promisedDeliveryAt,
    })
    .from(shipments)
    .where(eq(shipments.trackingCode, trackingCode))
    .limit(1);
  if (!shipment) return null;

  const rows = await db
    .select({
      type: shipmentEvents.type,
      status: shipmentEvents.toStatus,
      occurredAt: shipmentEvents.occurredAt,
      city: shipmentEvents.locationCity,
      publicNote: shipmentEvents.publicNote,
    })
    .from(shipmentEvents)
    .where(
      and(
        eq(shipmentEvents.shipmentId, shipment.id),
        inArray(shipmentEvents.type, PUBLIC_SHIPMENT_EVENT_TYPES),
      ),
    )
    .orderBy(asc(shipmentEvents.occurredAt), asc(shipmentEvents.recordedAt));
  // The WHERE clause above admits only public types; the column type cannot know that.
  const timeline = rows as PublicTrackingEvent[];

  const signedBy = shipment.status === "delivered" ? await findSignedBy(shipment.id) : null;

  return {
    trackingCode: shipment.trackingCode,
    status: shipment.status,
    origin: { city: shipment.originCity, country: shipment.originCountry },
    destination: { city: shipment.destinationCity, country: shipment.destinationCountry },
    promisedDeliveryAt: shipment.promisedDeliveryAt,
    signedBy,
    timeline,
  };
}

/** The recipient's printed name from the delivery proof: the one column of it that is public. */
async function findSignedBy(shipmentId: string): Promise<string | null> {
  const [proof] = await getDb()
    .select({ recipientName: deliveryProofs.recipientName })
    .from(deliveryProofs)
    .where(eq(deliveryProofs.shipmentId, shipmentId))
    .limit(1);
  return proof?.recipientName ?? null;
}
