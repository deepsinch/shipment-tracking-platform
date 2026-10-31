import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { haversineMeters, measureRoute } from "@/lib/route-geometry";
import { CITIES, demoCityPairs } from "@/server/seed/demo-data";

import type { RoadRoute } from "./road-route-fixture";
import { findRoadRoute, roadRoutes, routeBetween } from "./road-routes";

const city = (name: string) => CITIES.find((candidate) => candidate.city === name)!;

describe("the road route fixture", () => {
  it("is valid and small enough to commit", () => {
    expect(roadRoutes().length).toBeGreaterThan(0);
    const file = path.resolve(import.meta.dirname, "road-routes.json");
    expect(readFileSync(file).byteLength).toBeLessThan(200 * 1024);
  });

  // Fails when the seed's cities or shipments change: run `pnpm routes:fetch` again.
  it("has a road route for every pickup → delivery pair of the demo seed", () => {
    const missing = demoCityPairs()
      .filter(({ origin, destination }) => !findRoadRoute(origin, destination))
      .map(({ origin, destination }) => `${origin.city} → ${destination.city}`);
    expect(missing).toEqual([]);
  });

  it("starts and ends every route exactly at its stops, along plausible roads", () => {
    for (const route of roadRoutes()) {
      expect(route.coordinates[0]).toEqual([route.from.lng, route.from.lat]);
      expect(route.coordinates.at(-1)).toEqual([route.to.lng, route.to.lat]);
      // Roads are longer than the crow flies, but not absurdly so; the simplified line keeps
      // close to OSRM's own distance.
      const length = measureRoute({ type: "LineString", coordinates: route.coordinates }).lengthM;
      expect(length).toBeGreaterThan(haversineMeters(route.from, route.to));
      expect(length).toBeLessThan(haversineMeters(route.from, route.to) * 2);
      expect(Math.abs(length - route.distanceM) / route.distanceM).toBeLessThan(0.05);
    }
  });
});

describe("findRoadRoute", () => {
  const route: RoadRoute = {
    from: { city: "A", lat: 51, lng: 4 },
    to: { city: "B", lat: 52, lng: 5 },
    distanceM: 150_000,
    durationS: 6_000,
    coordinates: [
      [4, 51],
      [4.6, 51.4],
      [5, 52],
    ],
  };

  it("matches stops by coordinates, within about 10 m", () => {
    expect(findRoadRoute({ lat: 51.00005, lng: 3.99995 }, { lat: 52, lng: 5 }, [route])).toBe(
      route,
    );
  });

  it("does not match other stops, or the reverse direction", () => {
    expect(findRoadRoute({ lat: 51.001, lng: 4 }, { lat: 52, lng: 5 }, [route])).toBeNull();
    expect(findRoadRoute({ lat: 52, lng: 5 }, { lat: 51, lng: 4 }, [route])).toBeNull();
  });

  it("finds the fixture's route for a seeded pair", () => {
    const found = findRoadRoute(city("Rotterdam"), city("Hamburg"));
    expect(found?.from.city).toBe("Rotterdam");
    expect(found?.to.city).toBe("Hamburg");
  });
});

describe("routeBetween", () => {
  it("returns the road geometry when the fixture has it", () => {
    const result = routeBetween(city("Rotterdam"), city("Hamburg"));
    expect(result.kind).toBe("road");
    expect(result.line.coordinates.length).toBeGreaterThan(2);
  });

  it("falls back to a straight line otherwise", () => {
    expect(routeBetween({ lat: 48, lng: 11 }, { lat: 47, lng: 8 })).toEqual({
      kind: "straight",
      line: {
        type: "LineString",
        coordinates: [
          [11, 48],
          [8, 47],
        ],
      },
    });
  });
});
