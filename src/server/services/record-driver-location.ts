import "server-only";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { canRecordLocation } from "@/domain/location-sharing";
import { measureRoute } from "@/lib/route-geometry";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipmentPositions, shipments } from "@/server/db/schema";
import { env } from "@/server/env";
import { routeBetween } from "@/server/routes/road-routes";
import { nextSimulatedPosition, simulatedStepMeters } from "@/server/simulator/simulated-position";
import { DEFAULT_SIMULATOR_CONFIG } from "@/server/simulator/truck";

import { forbidden, notFound } from "./results";
import {
  recordLocationPing,
  type RecordLocationPingDeps,
  type RecordLocationPingResult,
} from "./record-location-ping";
import { visibleShipments } from "./shipment-access";

/**
 * The driver app's way to report a position: what its Server Action calls. `recordLocationPing`
 * stays the one place that stores positions (throttle, scope, history, realtime); this decides
 * which position it is given.
 *
 * Outside demo mode that is whatever the device reported, as before.
 *
 * In demo mode (`DEMO_MODE=true`) anyone can sign in as the demo driver, so a real position would
 * be published to every other visitor's live map. The coordinates, accuracy and device time the
 * client sent are therefore ignored altogether: only the shipment id is read, and the position is
 * the next point along the shipment's road route (`nextSimulatedPosition`), derived here from the
 * last stored position. A crafted request with real coordinates stores a simulated position.
 *
 * The truck simulator does not come through here: it calls `recordLocationPing` with positions it
 * computed itself.
 */

const demoPingSchema = z.object({ shipmentId: z.uuid() });

/** The route has to come from the stops' coordinates; a shipment booked without them has none. */
export type NoRoute = { ok: false; reason: "no_route" };

export type RecordDriverLocationResult = RecordLocationPingResult | NoRoute;

export type RecordDriverLocationDeps = RecordLocationPingDeps & {
  /** Defaults to `DEMO_MODE`, read from the environment. Injectable for tests. */
  demoMode?: boolean;
};

/** Metres of accuracy reported for a simulated fix, as the truck simulator does. */
const SIMULATED_ACCURACY_M = 10;

export async function recordDriverLocation(
  ctx: AuthContext,
  input: unknown,
  deps: RecordDriverLocationDeps = {},
): Promise<RecordDriverLocationResult> {
  const demoMode = deps.demoMode ?? env.demo.enabled;
  if (!demoMode) return recordLocationPing(ctx, input, deps);

  // Same answers as `recordLocationPing` for the same mistakes.
  if (!canRecordLocation(ctx.role)) return forbidden;
  const parsed = demoPingSchema.safeParse(input);
  if (!parsed.success) return notFound;
  const { shipmentId } = parsed.data;

  const [row] = await getDb()
    .select({
      status: shipments.status,
      originLat: shipments.originLat,
      originLng: shipments.originLng,
      destinationLat: shipments.destinationLat,
      destinationLng: shipments.destinationLng,
      lat: shipmentPositions.lat,
      lng: shipmentPositions.lng,
    })
    .from(shipments)
    .leftJoin(shipmentPositions, eq(shipmentPositions.shipmentId, shipments.id))
    .where(and(eq(shipments.id, shipmentId), visibleShipments(ctx)));
  if (!row) return notFound;

  const { originLat, originLng, destinationLat, destinationLng } = row;
  if (
    originLat === null ||
    originLng === null ||
    destinationLat === null ||
    destinationLng === null
  ) {
    return { ok: false, reason: "no_route" };
  }

  const route = measureRoute(
    routeBetween({ lat: originLat, lng: originLng }, { lat: destinationLat, lng: destinationLng })
      .line,
  );
  const last = row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng };
  const { point } = nextSimulatedPosition(
    route,
    last,
    simulatedStepMeters(row.status, DEFAULT_SIMULATOR_CONFIG),
  );

  const now = deps.now?.() ?? new Date();
  return recordLocationPing(
    ctx,
    {
      shipmentId,
      lat: point.lat,
      lng: point.lng,
      accuracyM: SIMULATED_ACCURACY_M,
      recordedAt: now,
    },
    { ...deps, now: () => now },
  );
}
