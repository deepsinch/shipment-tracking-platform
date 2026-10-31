import "server-only";

import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";

import { isTerminalStatus, SHIPMENT_STATUSES } from "@/domain/shipment-status";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import {
  shipmentPositions,
  shipments,
  type Shipment,
  type ShipmentPosition,
} from "@/server/db/schema";

import { validationFailure, type ValidationFailure } from "./results";
import { visibleShipments } from "./shipment-access";

/** Enough for any one organization's active fleet; a map asking for more is a bug. */
export const MAX_POSITION_IDS = 500;

const TERMINAL_STATUSES = SHIPMENT_STATUSES.filter(isTerminalStatus);

export const getShipmentPositionsSchema = z.object({
  /** Only these shipments (still within the caller's scope). Omit for all of them. */
  shipmentIds: z
    .array(z.uuid({ error: "Invalid shipment id" }))
    .max(MAX_POSITION_IDS, `Ask for at most ${MAX_POSITION_IDS} shipments`)
    .optional(),
});

export type GetShipmentPositionsInput = z.input<typeof getShipmentPositionsSchema>;

/** A shipment's latest known position, with what a map marker needs to label it. */
export type ShipmentPositionSnapshot = Pick<Shipment, "trackingCode" | "status"> &
  Pick<ShipmentPosition, "shipmentId" | "lat" | "lng" | "accuracyM" | "recordedAt" | "driverId">;

export type GetShipmentPositionsResult =
  { ok: true; positions: ShipmentPositionSnapshot[] } | ValidationFailure;

/**
 * The latest position of every unfinished shipment the caller can see, for the live map: the whole
 * organization for staff, their own assignments for a driver (`visibleShipments`). Shipments
 * without any accepted ping have no row and are left out.
 *
 * "Unfinished" includes `exception`: pings stop during an exception, but where the shipment was
 * last seen is exactly what dispatch needs then. Delivered and cancelled shipments drop off the
 * map even though their last position row remains.
 *
 * Most recent fix first. Clients re-fetch this snapshot on (re)connect and then apply live updates.
 */
export async function getShipmentPositions(
  ctx: AuthContext,
  input: unknown = {},
): Promise<GetShipmentPositionsResult> {
  const parsed = getShipmentPositionsSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error);
  const { shipmentIds } = parsed.data;
  if (shipmentIds?.length === 0) return { ok: true, positions: [] };

  const positions = await getDb()
    .select({
      shipmentId: shipmentPositions.shipmentId,
      trackingCode: shipments.trackingCode,
      status: shipments.status,
      lat: shipmentPositions.lat,
      lng: shipmentPositions.lng,
      accuracyM: shipmentPositions.accuracyM,
      recordedAt: shipmentPositions.recordedAt,
      driverId: shipmentPositions.driverId,
    })
    .from(shipmentPositions)
    .innerJoin(
      shipments,
      and(
        eq(shipments.id, shipmentPositions.shipmentId),
        eq(shipments.organizationId, shipmentPositions.organizationId),
      ),
    )
    .where(
      and(
        visibleShipments(ctx),
        notInArray(shipments.status, TERMINAL_STATUSES),
        shipmentIds ? inArray(shipments.id, shipmentIds) : undefined,
      ),
    )
    .orderBy(desc(shipmentPositions.recordedAt), desc(shipmentPositions.shipmentId));

  return { ok: true, positions };
}
