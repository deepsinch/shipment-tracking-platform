import "server-only";

import { and, asc, eq, getTableColumns, inArray } from "drizzle-orm";
import { z } from "zod";

import { driverAssignmentOf } from "@/domain/shipment-event";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import {
  shipmentEvents,
  shipments,
  user,
  type Shipment,
  type ShipmentEvent,
} from "@/server/db/schema";

import { notFound, type NotFound } from "./results";
import { visibleShipments } from "./shipment-access";

/** A history event with the names of the people involved. */
export type ShipmentEventWithActor = ShipmentEvent & {
  /** Who recorded it; null for system events. */
  actorName: string | null;
  /** For `driver_assigned` events, the old and new drivers' names (null = no driver). */
  assignment: { fromName: string | null; toName: string | null } | null;
};

export type ShipmentDetail = {
  shipment: Shipment;
  /** Display name of the assigned driver, or null when unassigned. */
  assignedDriverName: string | null;
  /** In real-world order (occurred_at), oldest first. */
  events: ShipmentEventWithActor[];
};

export type GetShipmentResult = ({ ok: true } & ShipmentDetail) | NotFound;

/**
 * A shipment with its full history (internal notes included), for the organization's own staff.
 * Shipments outside the caller's scope, and ids that are not UUIDs, are reported as not found.
 *
 * People are joined with LEFT JOINs: events may have no actor (system events), and a shipment may
 * have no driver. Users are never hard-deleted (see "Event history"), so a name is always found
 * when an id is set.
 */
export async function getShipment(ctx: AuthContext, id: string): Promise<GetShipmentResult> {
  // A malformed id cannot exist; checking first also avoids Postgres rejecting the uuid cast.
  if (!z.uuid().safeParse(id).success) return notFound;

  const db = getDb();
  const [row] = await db
    .select({ shipment: shipments, assignedDriverName: user.name })
    .from(shipments)
    .leftJoin(user, eq(user.id, shipments.assignedDriverId))
    .where(and(eq(shipments.id, id), visibleShipments(ctx)))
    .limit(1);
  if (!row) return notFound;
  const { shipment, assignedDriverName } = row;

  const rows = await db
    .select({ ...getTableColumns(shipmentEvents), actorName: user.name })
    .from(shipmentEvents)
    .leftJoin(user, eq(user.id, shipmentEvents.actorUserId))
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

  const names = await driverNamesOf(rows);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  const events = rows.map((event): ShipmentEventWithActor => {
    if (event.type !== "driver_assigned") return { ...event, assignment: null };
    const { fromDriverId, toDriverId } = driverAssignmentOf(event.metadata);
    return { ...event, assignment: { fromName: nameOf(fromDriverId), toName: nameOf(toDriverId) } };
  });

  return { ok: true, shipment, assignedDriverName, events };
}

/** Names of the drivers mentioned by `driver_assigned` events, in one query. */
async function driverNamesOf(events: ShipmentEvent[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type !== "driver_assigned") continue;
    const { fromDriverId, toDriverId } = driverAssignmentOf(event.metadata);
    if (fromDriverId) ids.add(fromDriverId);
    if (toDriverId) ids.add(toDriverId);
  }
  if (ids.size === 0) return new Map();

  const people = await getDb()
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, [...ids]));
  return new Map(people.map((person) => [person.id, person.name]));
}
