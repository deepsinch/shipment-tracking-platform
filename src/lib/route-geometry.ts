import type { LatLng, LineString } from "./geo";

/**
 * Distances and positions along a route LineString, for the route fixtures and the truck
 * simulator. Pure and framework-free. Coordinates are GeoJSON [longitude, latitude] pairs.
 *
 * Distances between consecutive points use the haversine formula. Projections onto a segment use
 * a local equirectangular approximation, which is accurate to well under a metre over the few
 * kilometres a simplified road segment spans.
 */

type Position = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const latLngOf = ([lng, lat]: Position): LatLng => ({ lat, lng });

/** Metres east and north of `origin`, on a plane tangent at its latitude. */
function toPlane(origin: Position, point: Position): { x: number; y: number } {
  const metresPerDegree = (Math.PI * EARTH_RADIUS_M) / 180;
  return {
    x: (point[0] - origin[0]) * metresPerDegree * Math.cos(toRadians(origin[1])),
    y: (point[1] - origin[1]) * metresPerDegree,
  };
}

/** Where on segment a-b the point p is closest: t from 0 (a) to 1 (b), and the distance. */
function projectOnSegment(a: Position, b: Position, p: Position): { t: number; distanceM: number } {
  const end = toPlane(a, b);
  const point = toPlane(a, p);
  const lengthSquared = end.x ** 2 + end.y ** 2;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, (point.x * end.x + point.y * end.y) / lengthSquared));
  return { t, distanceM: Math.hypot(point.x - t * end.x, point.y - t * end.y) };
}

/**
 * Douglas-Peucker simplification: drops every point that lies within `toleranceM` of the line
 * through the points kept around it. The first and last points always stay. Iterative, so a long
 * route cannot overflow the stack.
 */
export function simplifyLine(coordinates: readonly Position[], toleranceM: number): Position[] {
  if (coordinates.length <= 2) return coordinates.map(([lng, lat]) => [lng, lat]);
  const keep = new Array<boolean>(coordinates.length).fill(false);
  keep[0] = true;
  keep[coordinates.length - 1] = true;

  const ranges: [number, number][] = [[0, coordinates.length - 1]];
  while (ranges.length > 0) {
    const [first, last] = ranges.pop()!;
    let farthest = -1;
    let farthestDistance = toleranceM;
    for (let i = first + 1; i < last; i++) {
      const { distanceM } = projectOnSegment(
        coordinates[first]!,
        coordinates[last]!,
        coordinates[i]!,
      );
      if (distanceM > farthestDistance) {
        farthest = i;
        farthestDistance = distanceM;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = true;
      ranges.push([first, farthest], [farthest, last]);
    }
  }
  return coordinates.filter((_, i) => keep[i]).map(([lng, lat]) => [lng, lat]);
}

/** A route with the distance from its start to each point, so lookups along it are cheap. */
export type MeasuredRoute = {
  coordinates: readonly Position[];
  /** `cumulativeM[i]` is the distance along the route from the start to point i. */
  cumulativeM: readonly number[];
  lengthM: number;
};

export function measureRoute(route: LineString): MeasuredRoute {
  const { coordinates } = route;
  if (coordinates.length === 0) throw new Error("A route needs at least one point");
  const cumulativeM = [0];
  for (let i = 1; i < coordinates.length; i++) {
    cumulativeM.push(
      cumulativeM[i - 1]! +
        haversineMeters(latLngOf(coordinates[i - 1]!), latLngOf(coordinates[i]!)),
    );
  }
  return { coordinates, cumulativeM, lengthM: cumulativeM.at(-1)! };
}

/** The point `distanceM` along the route, clamped to its start and end. */
export function pointAlong(route: MeasuredRoute, distanceM: number): LatLng {
  const { coordinates, cumulativeM, lengthM } = route;
  if (distanceM <= 0 || coordinates.length === 1) return latLngOf(coordinates[0]!);
  if (distanceM >= lengthM) return latLngOf(coordinates.at(-1)!);

  // Binary search for the segment [i - 1, i] that contains the distance.
  let low = 1;
  let high = coordinates.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cumulativeM[middle]! < distanceM) low = middle + 1;
    else high = middle;
  }
  const start = cumulativeM[low - 1]!;
  const segment = cumulativeM[low]! - start;
  const t = segment === 0 ? 0 : (distanceM - start) / segment;
  const [lng0, lat0] = coordinates[low - 1]!;
  const [lng1, lat1] = coordinates[low]!;
  return { lat: lat0 + (lat1 - lat0) * t, lng: lng0 + (lng1 - lng0) * t };
}

/**
 * How far along the route the point closest to `point` is, in metres: where a truck last seen at
 * `point` is on its route. Ties go to the earlier segment, so a route that passes the same place
 * twice resolves to the first pass.
 */
export function distanceAlong(route: MeasuredRoute, point: LatLng): number {
  const { coordinates, cumulativeM } = route;
  if (coordinates.length === 1) return 0;
  const target: Position = [point.lng, point.lat];
  let best = { distanceM: Infinity, alongM: 0 };
  for (let i = 1; i < coordinates.length; i++) {
    const { t, distanceM } = projectOnSegment(coordinates[i - 1]!, coordinates[i]!, target);
    if (distanceM < best.distanceM) {
      const segment = cumulativeM[i]! - cumulativeM[i - 1]!;
      best = { distanceM, alongM: cumulativeM[i - 1]! + t * segment };
    }
  }
  return best.alongM;
}
