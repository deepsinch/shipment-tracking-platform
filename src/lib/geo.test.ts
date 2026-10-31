import { describe, expect, it } from "vitest";

import {
  boundsOf,
  easeOutCubic,
  formatCoordinates,
  interpolateLatLng,
  straightLineRoute,
} from "./geo";

const ROTTERDAM = { lat: 51.9055, lng: 4.4886 };
const ANTWERP = { lat: 51.2181, lng: 4.4085 };
const COLOGNE = { lat: 50.9384, lng: 6.9583 };

describe("boundsOf", () => {
  it("has no bounds without points", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("spans every point as [[west, south], [east, north]]", () => {
    expect(boundsOf([ROTTERDAM, ANTWERP, COLOGNE])).toEqual([
      [4.4085, 50.9384],
      [6.9583, 51.9055],
    ]);
  });

  it("collapses to the point itself for a single point", () => {
    expect(boundsOf([ANTWERP])).toEqual([
      [4.4085, 51.2181],
      [4.4085, 51.2181],
    ]);
  });
});

describe("straightLineRoute", () => {
  it("is a GeoJSON LineString in [longitude, latitude] order", () => {
    expect(straightLineRoute(ROTTERDAM, ANTWERP)).toEqual({
      type: "LineString",
      coordinates: [
        [4.4886, 51.9055],
        [4.4085, 51.2181],
      ],
    });
  });
});

describe("formatCoordinates", () => {
  it("shows four decimals, latitude first", () => {
    expect(formatCoordinates({ lat: 51.21944, lng: 4.40251 })).toBe("51.2194, 4.4025");
    expect(formatCoordinates({ lat: -0.5, lng: 10 })).toBe("-0.5000, 10.0000");
  });
});

describe("easing", () => {
  it("starts at 0, ends at 1 and slows down towards the end", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    // Frames that overshoot the duration stay at the end.
    expect(easeOutCubic(1.3)).toBe(1);
    expect(easeOutCubic(-0.1)).toBe(0);
  });

  it("interpolates between two positions", () => {
    expect(interpolateLatLng(ROTTERDAM, ANTWERP, 0)).toEqual(ROTTERDAM);
    expect(interpolateLatLng(ROTTERDAM, ANTWERP, 1)).toEqual(ANTWERP);
    const half = interpolateLatLng({ lat: 50, lng: 4 }, { lat: 51, lng: 5 }, 0.5);
    expect(half).toEqual({ lat: 50.5, lng: 4.5 });
    expect(interpolateLatLng(ROTTERDAM, ANTWERP, 2)).toEqual(ANTWERP);
  });
});
