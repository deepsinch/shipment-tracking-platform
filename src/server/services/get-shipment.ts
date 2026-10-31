import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipmentEvents, shipments, type Shipment, type ShipmentEvent } from "@/server/db/schema";

import { notFound, type NotFound } from "./results";
import { visibleShipments } from "./shipment-access";

export type GetShipmentResult =
  { ok: true; shipment: Shipment; events: ShipmentEvent[] } | NotFound;

/**
 * A shipment with its full history (internal notes included), for the organization's own staff.
 * Shipments outside the caller's scope, and ids that are not UUIDs, are reported as not found.
 */
export async function getShipment(ctx: AuthContext, id: string): Promise<GetShipmentResult> {
  // A malformed id cannot exist; checking first also avoids Postgres rejecting the uuid cast.
  if (!z.uuid().safeParse(id).success) return notFound;

  const db = getDb();
  const [shipment] = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.id, id), visibleShipments(ctx)))
    .limit(1);
  if (!shipment) return notFound;

  const events = await db
    .select()
    .from(shipmentEvents)
    // The organization filter is redundant with the shipment check above, but keeps the rule
    // "every tenant query filters by organization" true without reasoning about it.
    .where(
      and(
        eq(shipmentEvents.shipmentId, shipment.id),
        eq(shipmentEvents.organizationId, ctx.organizationId),
      ),
    )
    // Real-world order; recorded_at breaks ties between events with the same occurred_at.
    .orderBy(asc(shipmentEvents.occurredAt), asc(shipmentEvents.recordedAt));

  return { ok: true, shipment, events };
}
