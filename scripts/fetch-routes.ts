/**
 * `pnpm routes:fetch` — one-off: fetches driving routes for every pickup → delivery city pair of
 * the demo seed from the public OSRM demo server and writes the committed fixture
 * `src/server/routes/road-routes.json`.
 *
 * Not part of the build or the tests: the app and the simulator only read the committed file.
 * Re-run it when the seed's cities or shipments change (the coverage test in
 * `road-routes.test.ts` fails until then).
 *
 * The demo server is a shared, donated resource (usage policy: at most one request per second,
 * a valid User-Agent, no heavy use), so requests go one at a time with a pause between them.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { z } from "zod";

import { simplifyLine } from "@/lib/route-geometry";
import {
  roadRouteFixtureSchema,
  serializeRoadRouteFixture,
  type RoadRoute,
} from "@/server/routes/road-route-fixture";
import { demoCityPairs, type City } from "@/server/seed/demo-data";

const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";
const USER_AGENT =
  "Waybill-route-fixtures/1.0 (portfolio project; https://github.com/deepsinch/shipment-tracking-platform)";
const PAUSE_MS = 1_500;
/** A metre or so on the map at any zoom the app uses, and keeps the file well under 200 KB. */
const TOLERANCE_M = 120;
const OUTPUT = path.resolve(import.meta.dirname, "../src/server/routes/road-routes.json");

const osrmResponse = z.object({
  code: z.string(),
  message: z.string().optional(),
  routes: z
    .array(
      z.object({
        distance: z.number(),
        duration: z.number(),
        geometry: z.object({
          type: z.literal("LineString"),
          coordinates: z.array(z.tuple([z.number(), z.number()])),
        }),
      }),
    )
    .optional(),
});

/** Five decimals is about a metre: more precision only makes the file bigger. */
const round = (degrees: number) => Math.round(degrees * 1e5) / 1e5;

async function fetchRoute(origin: City, destination: City): Promise<RoadRoute> {
  const url =
    `${OSRM_URL}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}` +
    `?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`OSRM answered ${response.status} ${response.statusText} for ${url}`);
  }
  const body = osrmResponse.parse(await response.json());
  const route = body.routes?.[0];
  if (body.code !== "Ok" || !route) {
    throw new Error(`OSRM could not route ${url}: ${body.code} ${body.message ?? ""}`);
  }

  // OSRM snaps both ends to the nearest road; start and end exactly at the stops instead, so the
  // line meets the pickup and delivery pins on the map.
  const road = simplifyLine(route.geometry.coordinates, TOLERANCE_M);
  const coordinates: [number, number][] = [
    [origin.lng, origin.lat],
    ...road.map(([lng, lat]): [number, number] => [round(lng), round(lat)]),
    [destination.lng, destination.lat],
  ];
  return {
    from: { city: origin.city, lat: origin.lat, lng: origin.lng },
    to: { city: destination.city, lat: destination.lat, lng: destination.lng },
    distanceM: Math.round(route.distance),
    durationS: Math.round(route.duration),
    coordinates,
  };
}

async function main(): Promise<void> {
  const pairs = demoCityPairs();
  console.log(`Fetching ${pairs.length} routes from ${OSRM_URL} …`);

  const routes: RoadRoute[] = [];
  for (const [i, { origin, destination }] of pairs.entries()) {
    if (i > 0) await sleep(PAUSE_MS);
    const route = await fetchRoute(origin, destination);
    routes.push(route);
    console.log(
      `  ${origin.city} → ${destination.city}: ${(route.distanceM / 1000).toFixed(0)} km, ` +
        `${route.coordinates.length} points`,
    );
  }

  const fixture = roadRouteFixtureSchema.parse({
    source:
      "OSRM demo server (router.project-osrm.org); route data © OpenStreetMap contributors, ODbL",
    fetchedAt: new Date().toISOString(),
    toleranceM: TOLERANCE_M,
    routes,
  });
  const json = serializeRoadRouteFixture(fixture);
  await writeFile(OUTPUT, json);
  console.log(
    `Wrote ${path.relative(process.cwd(), OUTPUT)} (${(json.length / 1024).toFixed(0)} KB).`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
