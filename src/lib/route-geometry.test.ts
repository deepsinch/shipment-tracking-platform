import { describe, expect, it } from "vitest";

import type { LineString } from "./geo";
import {
  distanceAlong,
  haversineMeters,
  measureRoute,
  pointAlong,
  simplifyLine,
} from "./route-geometry";

const ROTTERDAM = { lat: 51.9055, lng: 4.4886 };
const ANTWERP = { lat: 51.2181, lng: 4.4085 };

/** Along a meridian a degree of latitude is about 111.2 km, which makes distances easy to state. */
const meridian: LineString = {
  type: "LineString",
  coordinates: [
    [5, 50],
    [5, 50.5],
    [5, 51],
  ],
};

describe("haversineMeters", () => {
  it("measures Rotterdam to Antwerp as the crow flies (about 77 km)", () => {
    expect(haversineMeters(ROTTERDAM, ANTWERP) / 1000).toBeCloseTo(76.6, 0);
  });

  it("is zero for the same point and symmetric", () => {
    expect(haversineMeters(ANTWERP, ANTWERP)).toBe(0);
    expect(haversineMeters(ROTTERDAM, ANTWERP)).toBeCloseTo(haversineMeters(ANTWERP, ROTTERDAM));
  });
});

describe("simplifyLine", () => {
  it("drops points that lie within the tolerance of a straight stretch", () => {
    const wobbly: [number, number][] = [
      [5, 50],
      [5.0001, 50.25], // about 7 m off the line
      [5, 50.5],
      [5.05, 50.75], // about 3.6 km off the line
      [5, 51],
    ];
    expect(simplifyLine(wobbly, 50)).toEqual([
      [5, 50],
      [5, 50.5],
      [5.05, 50.75],
      [5, 51],
    ]);
  });

  it("always keeps the first and last points", () => {
    const line: [number, number][] = [
      [5, 50],
      [5, 50.5],
      [5, 51],
    ];
    expect(simplifyLine(line, 1000)).toEqual([
      [5, 50],
      [5, 51],
    ]);
    expect(simplifyLine([[5, 50]], 1000)).toEqual([[5, 50]]);
  });

  it("keeps every point when the tolerance is zero and the line bends", () => {
    const zigzag: [number, number][] = [
      [5, 50],
      [5.1, 50.1],
      [5, 50.2],
      [5.1, 50.3],
    ];
    expect(simplifyLine(zigzag, 0)).toEqual(zigzag);
  });
});

describe("measureRoute and pointAlong", () => {
  const route = measureRoute(meridian);

  it("accumulates the distance to each point", () => {
    expect(route.cumulativeM[0]).toBe(0);
    expect(route.cumulativeM[1]! / 1000).toBeCloseTo(55.6, 1);
    expect(route.lengthM / 1000).toBeCloseTo(111.2, 1);
  });

  it("finds the point a given distance along, across segments", () => {
    expect(pointAlong(route, route.lengthM / 4)).toEqual({ lat: expect.closeTo(50.25, 6), lng: 5 });
    expect(pointAlong(route, (route.lengthM * 3) / 4)).toEqual({
      lat: expect.closeTo(50.75, 6),
      lng: 5,
    });
    expect(pointAlong(route, route.cumulativeM[1]!)).toEqual({ lat: 50.5, lng: 5 });
  });

  it("clamps to the start and end", () => {
    expect(pointAlong(route, -10)).toEqual({ lat: 50, lng: 5 });
    expect(pointAlong(route, route.lengthM + 10)).toEqual({ lat: 51, lng: 5 });
  });

  it("refuses an empty route and handles a single point", () => {
    expect(() => measureRoute({ type: "LineString", coordinates: [] })).toThrow();
    const point = measureRoute({ type: "LineString", coordinates: [[5, 50]] });
    expect(point.lengthM).toBe(0);
    expect(pointAlong(point, 100)).toEqual({ lat: 50, lng: 5 });
  });
});

describe("distanceAlong", () => {
  const route = measureRoute(meridian);

  it("is the inverse of pointAlong for points on the route", () => {
    for (const fraction of [0, 0.1, 0.5, 0.9, 1]) {
      const distance = route.lengthM * fraction;
      expect(distanceAlong(route, pointAlong(route, distance))).toBeCloseTo(distance, 0);
    }
  });

  it("projects a point off the route onto its nearest point", () => {
    // 0.1 degrees east of the 50.25 mark, about 7 km off the road.
    expect(distanceAlong(route, { lat: 50.25, lng: 5.1 }) / 1000).toBeCloseTo(27.8, 1);
  });

  it("clamps points beyond either end", () => {
    expect(distanceAlong(route, { lat: 49, lng: 5 })).toBe(0);
    expect(distanceAlong(route, { lat: 52, lng: 5 })).toBeCloseTo(route.lengthM, 6);
  });
});
