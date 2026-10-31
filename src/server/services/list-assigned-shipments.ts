import "server-only";

import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";

import { SHIPMENT_STATUSES, isTerminalStatus } from "@/domain/shipment-status";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipments, type Shipment } from "@/server/db/schema";

import { visibleShipments } from "./shipment-access";

/** How many finished (delivered or cancelled) shipments the driver app shows. */
export const FINISHED_LIMIT = 10;

const TERMINAL_STATUSES = SHIPMENT_STATUSES.filter(isTerminalStatus);

/** What a driver needs on the road: addresses, recipient and deadline; nothing commercial. */
const columns = {
  id: shipments.id,
  trackingCode: shipments.trackingCode,
  status: shipments.status,
  recipientName: shipments.recipientName,
  originAddressLine: shipments.originAddressLine,
  originCity: shipments.originCity,
  originCountry: shipments.originCountry,
  destinationAddressLine: shipments.destinationAddressLine,
  destinationCity: shipments.destinationCity,
  destinationCountry: shipments.destinationCountry,
  serviceLevel: shipments.serviceLevel,
  promisedDeliveryAt: shipments.promisedDeliveryAt,
  updatedAt: shipments.updatedAt,
} as const;

export type AssignedShipment = Pick<Shipment, keyof typeof columns>;

export type AssignedShipments = {
  /** Still to do, most urgent first: earliest promised delivery, then oldest booking. */
  active: AssignedShipment[];
  /** The latest delivered or cancelled ones, most recently finished first. */
  finished: AssignedShipment[];
};

/**
 * The caller's own assignments, for the driver app. Built on `visibleShipments`, plus "assigned to
 * me": for a driver that is the same scope, and for staff it keeps the list personal rather than
 * the whole organization. Drivers carry a handful of jobs, so active ones are not paginated.
 */
export async function listAssignedShipments(ctx: AuthContext): Promise<AssignedShipments> {
  const mine = and(visibleShipments(ctx), eq(shipments.assignedDriverId, ctx.userId));
  const db = getDb();

  const [active, finished] = await Promise.all([
    db
      .select(columns)
      .from(shipments)
      .where(and(mine, notInArray(shipments.status, TERMINAL_STATUSES)))
      .orderBy(
        sql`${shipments.promisedDeliveryAt} ASC NULLS LAST`,
        asc(shipments.createdAt),
        asc(shipments.id),
      ),
    db
      .select(columns)
      .from(shipments)
      .where(and(mine, inArray(shipments.status, TERMINAL_STATUSES)))
      .orderBy(desc(shipments.updatedAt), desc(shipments.id))
      .limit(FINISHED_LIMIT),
  ]);

  return { active, finished };
}
