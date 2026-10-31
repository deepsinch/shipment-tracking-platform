import "server-only";

import { straightLineRoute, type LatLng, type RouteLine } from "@/lib/geo";

import fixtureJson from "./road-routes.json";
import { roadRouteFixtureSchema, type RoadRoute } from "./road-route-fixture";

/**
 * Road routes between known stops, from the committed OSRM fixture (`road-routes.json`, written by
 * `pnpm routes:fetch`). A plain in-memory lookup: no network at runtime, and server-only, so the
 * fixture never reaches a browser bundle (pages pass on the one LineString they need).
 */

/**
 * Stops match a fixture route when both ends are within this many degrees (about 10 m), so a
 * route applies to shipments booked with the seed's coordinates, whatever the city is called.
 */
const MATCH_TOLERANCE_DEG = 1e-4;

let cached: readonly RoadRoute[] | undefined;

/** The fixture's routes, validated once on first use. */
export function roadRoutes(): readonly RoadRoute[] {
  cached ??= roadRouteFixtureSchema.parse(fixtureJson).routes;
  return cached;
}

const near = (a: LatLng, b: LatLng) =>
  Math.abs(a.lat - b.lat) <= MATCH_TOLERANCE_DEG && Math.abs(a.lng - b.lng) <= MATCH_TOLERANCE_DEG;

/** The road route from `origin` to `destination`, or null when the fixture has none. */
export function findRoadRoute(
  origin: LatLng,
  destination: LatLng,
  routes: readonly RoadRoute[] = roadRoutes(),
): RoadRoute | null {
  return routes.find((route) => near(route.from, origin) && near(route.to, destination)) ?? null;
}

/**
 * The line to draw (or drive) between two stops: the road route when the fixture has one, a
 * straight line otherwise (UI-booked shipments between other places). Over the distances the demo
 * covers, a straight line in degrees is close enough to the great circle.
 */
export function routeBetween(
  origin: LatLng,
  destination: LatLng,
  routes: readonly RoadRoute[] = roadRoutes(),
): RouteLine {
  const road = findRoadRoute(origin, destination, routes);
  return road
    ? { kind: "road", line: { type: "LineString", coordinates: road.coordinates } }
    : { kind: "straight", line: straightLineRoute(origin, destination) };
}
