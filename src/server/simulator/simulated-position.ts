import type { ShipmentStatus } from "@/domain/shipment-status";
import type { LatLng } from "@/lib/geo";
import { distanceAlong, pointAlong, type MeasuredRoute } from "@/lib/route-geometry";

import { stepMeters, type SimulatorConfig } from "./truck";

/**
 * The next simulated position of a truck on its route, for a demo visitor who switches on "Share
 * my location" in the driver app (`recordDriverLocation`). On a public demo the visitor's real
 * position is never used (see docs/architecture.md, "Demo mode"): the server derives a position
 * along the shipment's road route instead, with the same route geometry and pace as the truck
 * simulator, so the two never fight over where the truck is.
 *
 * Pure: the route, the last stored position and the step are arguments.
 */

/** Degrees to five decimals (about a metre), as the simulator stores them. */
export const roundDegrees = (degrees: number) => Math.round(degrees * 1e5) / 1e5;

/** Metres one simulated ping moves the truck: the simulator's pace for the shipment's status. */
export function simulatedStepMeters(status: ShipmentStatus, config: SimulatorConfig): number {
  return stepMeters(config, status === "out_for_delivery" ? config.deliveryKmh : config.cruiseKmh);
}

/**
 * One step further along `route` than `lastPosition` (projected onto the route), or from the
 * start when the shipment has no position yet. Stops at the end of the route.
 */
export function nextSimulatedPosition(
  route: MeasuredRoute,
  lastPosition: LatLng | null,
  stepM: number,
): { point: LatLng; distanceM: number } {
  const fromM = lastPosition ? distanceAlong(route, lastPosition) : 0;
  const distanceM = Math.min(route.lengthM, fromM + Math.max(0, stepM));
  const { lat, lng } = pointAlong(route, distanceM);
  return { point: { lat: roundDegrees(lat), lng: roundDegrees(lng) }, distanceM };
}
