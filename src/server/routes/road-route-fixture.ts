import { z } from "zod";

/**
 * The committed road route fixture (`road-routes.json`): driving geometry for the demo seed's city
 * pairs, fetched once from a public OSRM server by `pnpm routes:fetch` and simplified. Nothing
 * fetches routes at runtime. See docs/architecture.md, decision 18.
 */

const coordinate = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const endpoint = z.object({ city: z.string().min(1), lat: z.number(), lng: z.number() });

export const roadRouteSchema = z.object({
  from: endpoint,
  to: endpoint,
  /** OSRM's driving distance and duration for the full (unsimplified) route. */
  distanceM: z.number().positive(),
  durationS: z.number().positive(),
  /** GeoJSON [longitude, latitude] pairs from `from` to `to`, simplified. */
  coordinates: z.array(coordinate).min(2),
});

export const roadRouteFixtureSchema = z.object({
  source: z.string(),
  fetchedAt: z.iso.datetime(),
  /** Douglas-Peucker tolerance used to simplify the geometry. */
  toleranceM: z.number().nonnegative(),
  routes: z.array(roadRouteSchema),
});

export type RoadRoute = z.infer<typeof roadRouteSchema>;
export type RoadRouteFixture = z.infer<typeof roadRouteFixtureSchema>;

/**
 * JSON for the fixture file: readable metadata, one line per route's coordinate list, so the file
 * stays small and a re-fetch diffs route by route. Prettier ignores the file (it would put every
 * number on its own line).
 */
export function serializeRoadRouteFixture(fixture: RoadRouteFixture): string {
  const routes = fixture.routes.map((route) => {
    const { coordinates, ...rest } = route;
    const head = JSON.stringify(rest).slice(0, -1);
    return `    ${head},"coordinates":${JSON.stringify(coordinates)}}`;
  });
  const { source, fetchedAt, toleranceM } = fixture;
  const metaLines = Object.entries({ source, fetchedAt, toleranceM }).map(
    ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
  );
  return `{\n${metaLines.join("\n")}\n  "routes": [\n${routes.join(",\n")}\n  ]\n}\n`;
}
