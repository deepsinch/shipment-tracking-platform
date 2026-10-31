/**
 * Small, framework-free geometry for the maps. Coordinates are WGS 84 degrees. MapLibre and GeoJSON
 * order them [longitude, latitude]; our own objects name the fields to avoid that trap.
 */

export type LatLng = { lat: number; lng: number };

/** [[west, south], [east, north]], the shape MapLibre's `fitBounds` and `bounds` accept. */
export type Bounds = [[number, number], [number, number]];

/** A GeoJSON LineString (RFC 7946), [longitude, latitude] pairs. */
export type LineString = { type: "LineString"; coordinates: [number, number][] };

/** A route to draw: along real roads, or a straight line that only shows the direction. */
export type RouteLine = { kind: "road" | "straight"; line: LineString };

/**
 * The view when there is nothing to show: Western Europe, from Brittany to Bohemia and from the
 * Pyrenees to Denmark, where the demo carrier operates.
 */
export const WESTERN_EUROPE: Bounds = [
  [-5, 42.5],
  [16, 56],
];

/**
 * The smallest box holding every point, or null without points. A single point gives a zero-size
 * box; the map's `maxZoom` on fitting keeps it from zooming into the street.
 *
 * Takes plain min/max, so a set straddling the antimeridian would span the globe the long way
 * round. Fine for a European carrier; a global fleet would need the shortest-arc version.
 */
export function boundsOf(points: readonly LatLng[]): Bounds | null {
  if (points.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const { lat, lng } of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}

/**
 * A straight line between two stops: the fallback route when no road geometry is known for them
 * (see `routeBetween` in `src/server/routes/road-routes.ts`).
 */
export function straightLineRoute(from: LatLng, to: LatLng): LineString {
  return {
    type: "LineString",
    coordinates: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
  };
}

/** "51.2194, 4.4025": four decimals is about 10 m, plenty for "where is the truck". */
export function formatCoordinates({ lat, lng }: LatLng): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/** Ease-out cubic: quick start, gentle stop, the way a marker should glide to its new fix. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

/**
 * The point `t` (0 to 1) of the way from `from` to `to`, interpolating degrees linearly. Over the
 * few hundred metres between two pings that is indistinguishable from the great circle.
 */
export function interpolateLatLng(from: LatLng, to: LatLng, t: number): LatLng {
  const k = Math.min(1, Math.max(0, t));
  return { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k };
}
