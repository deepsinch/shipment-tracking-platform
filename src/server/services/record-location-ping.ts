import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { isTooFarInFuture } from "@/domain/device-time";
import {
  canRecordLocation,
  isLocationSharingStatus,
  PING_INTERVAL_MS,
} from "@/domain/location-sharing";
import type { ShipmentStatus } from "@/domain/shipment-status";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { locationPings, shipmentPositions, shipments, type LocationPing } from "@/server/db/schema";

import {
  forbidden,
  notFound,
  validationFailure,
  type Forbidden,
  type NotFound,
  type ValidationFailure,
} from "./results";
import { announcePosition } from "./realtime-signals";
import { visibleShipments } from "./shipment-access";

/**
 * Pings come from code (the driver app's Geolocation callback), not from a form, so numbers are
 * not coerced: `z.coerce.number()` would turn a missing `null` into 0, a valid coordinate.
 */
const coordinate = (kind: "latitude" | "longitude") => {
  const limit = kind === "latitude" ? 90 : 180;
  const message = `Enter a ${kind} between -${limit} and ${limit}`;
  return z.number({ error: message }).min(-limit, message).max(limit, message);
};

export const recordLocationPingSchema = z.object({
  shipmentId: z.uuid(),
  lat: coordinate("latitude"),
  lng: coordinate("longitude"),
  /** Metres, as reported by the Geolocation API. */
  accuracyM: z.number({ error: "Enter the accuracy in metres" }).min(0, "Cannot be negative"),
  /** Device time of the fix. A Date, or an ISO string from JSON. */
  recordedAt: z.preprocess(
    (value) => (typeof value === "string" ? new Date(value) : value),
    z.date({ error: "Enter a valid date and time" }),
  ),
});

export type RecordLocationPingInput = z.input<typeof recordLocationPingSchema>;

export type RecordLocationPingResult =
  /**
   * Stored. `positionMoved` is false for a late ping (older than the current position): it is kept
   * in the history but does not move the shipment on the map.
   */
  | { ok: true; accepted: true; ping: LocationPing; positionMoved: boolean }
  /** Another ping for this shipment was accepted less than `PING_INTERVAL_MS` ago; nothing written. */
  | { ok: true; accepted: false; reason: "throttled" }
  /** The shipment is not on the road (see `isLocationSharingStatus`); the client should stop. */
  | { ok: false; reason: "inactive"; status: ShipmentStatus }
  | Forbidden
  | NotFound
  | ValidationFailure;

export type RecordLocationPingDeps = {
  /** The server clock; injectable so tests can step past the throttle window. */
  now?: () => Date;
};

/**
 * Stores a position reported by the driver app. Only drivers, only for a shipment assigned to them
 * (`visibleShipments`), and only while it is on the road. At most one ping per shipment is accepted
 * every `PING_INTERVAL_MS`; pings inside the window are acknowledged and dropped.
 *
 * The throttle lives in one conditional upsert on `shipment_positions`, whose `updated_at` is the
 * time of the last accepted ping:
 *
 *   INSERT ... ON CONFLICT (shipment_id) DO UPDATE ... WHERE updated_at <= now - interval
 *
 * Postgres serializes concurrent upserts of one row: the second waits for the first to commit,
 * then re-evaluates the WHERE against the committed row (now inside the window) and returns no
 * row. So two parallel pings can never both be accepted, with no extra lock or counter table. Only
 * when the upsert returns a row is the ping inserted, in the same transaction.
 *
 * A late ping (device time older than the stored position, e.g. delivered out of order after a
 * reconnect) is stored and counts for the throttle, but the CASE expressions keep the newer
 * position. `shipments.version` is never touched: telemetry must not turn open status forms stale.
 *
 * A ping that moves the position is announced on the realtime bus in the same transaction; a
 * throttled or late one is not.
 */
export async function recordLocationPing(
  ctx: AuthContext,
  input: unknown,
  deps: RecordLocationPingDeps = {},
): Promise<RecordLocationPingResult> {
  // Reveals nothing about any shipment: only drivers report positions, whatever the id.
  if (!canRecordLocation(ctx.role)) return forbidden;

  const parsed = recordLocationPingSchema.safeParse(input);
  if (!parsed.success) {
    // A malformed id cannot match any shipment: report it like any other unknown id.
    const badId = parsed.error.issues.some((issue) => issue.path[0] === "shipmentId");
    return badId ? notFound : validationFailure(parsed.error);
  }
  const { shipmentId, lat, lng, accuracyM, recordedAt } = parsed.data;

  const now = deps.now?.() ?? new Date();
  if (isTooFarInFuture(recordedAt, now)) {
    return {
      ok: false,
      reason: "validation",
      fieldErrors: { recordedAt: ["The time cannot be in the future"] },
    };
  }
  const windowStart = new Date(now.getTime() - PING_INTERVAL_MS);

  return getDb().transaction(async (tx): Promise<RecordLocationPingResult> => {
    // FOR SHARE: a concurrent status change (an UPDATE of this row) waits until we commit, so a
    // ping is never accepted for a shipment that was delivered while it was being stored. Pings do
    // not block each other on this lock.
    const [shipment] = await tx
      .select({ status: shipments.status })
      .from(shipments)
      .where(and(eq(shipments.id, shipmentId), visibleShipments(ctx)))
      .for("share");
    if (!shipment) return notFound;
    if (!isLocationSharingStatus(shipment.status)) {
      return { ok: false, reason: "inactive", status: shipment.status };
    }

    // Each column keeps its stored value unless the incoming fix is at least as recent.
    const newerOr = (column: string) =>
      sql.raw(
        `CASE WHEN excluded.recorded_at >= shipment_positions.recorded_at ` +
          `THEN excluded.${column} ELSE shipment_positions.${column} END`,
      );
    const [position] = await tx
      .insert(shipmentPositions)
      .values({
        shipmentId,
        organizationId: ctx.organizationId,
        lat,
        lng,
        accuracyM,
        recordedAt,
        driverId: ctx.userId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: shipmentPositions.shipmentId,
        set: {
          lat: newerOr("lat"),
          lng: newerOr("lng"),
          accuracyM: newerOr("accuracy_m"),
          driverId: newerOr("driver_id"),
          recordedAt: newerOr("recorded_at"),
          updatedAt: now,
        },
        // The throttle. Evaluated against the latest committed row, see above.
        setWhere: sql`${shipmentPositions.updatedAt} <= ${windowStart}`,
      })
      .returning({ recordedAt: shipmentPositions.recordedAt });
    if (!position) return { ok: true, accepted: false, reason: "throttled" };

    const [ping] = await tx
      .insert(locationPings)
      .values({
        organizationId: ctx.organizationId,
        shipmentId,
        driverId: ctx.userId,
        lat,
        lng,
        accuracyM,
        recordedAt,
        receivedAt: now,
      })
      .returning();

    const positionMoved = position.recordedAt.getTime() === recordedAt.getTime();
    // A late ping is history only: the shipment's position did not change, so nothing to say.
    if (positionMoved) {
      await announcePosition(tx, {
        organizationId: ctx.organizationId,
        shipmentId,
        driverId: ctx.userId,
        lat,
        lng,
        recordedAt,
      });
    }

    return { ok: true, accepted: true, ping: ping!, positionMoved };
  });
}
