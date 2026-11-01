import { describe, expect, it } from "vitest";

import { haversineMeters, measureRoute } from "@/lib/route-geometry";

import { nextSimulatedPosition, roundDegrees, simulatedStepMeters } from "./simulated-position";
import { DEFAULT_SIMULATOR_CONFIG, stepMeters } from "./truck";

/** Along a meridian a degree of latitude is about 111.2 km: 50 N to 51 N, 111 km long. */
const route = measureRoute({
  type: "LineString",
  coordinates: [
    [5, 50],
    [5, 50.5],
    [5, 51],
  ],
});

describe("simulatedStepMeters", () => {
  it("is the simulator's pace: cruising speed on the road, slower once out for delivery", () => {
    const cruise = stepMeters(DEFAULT_SIMULATOR_CONFIG, DEFAULT_SIMULATOR_CONFIG.cruiseKmh);
    const town = stepMeters(DEFAULT_SIMULATOR_CONFIG, DEFAULT_SIMULATOR_CONFIG.deliveryKmh);
    expect(simulatedStepMeters("in_transit", DEFAULT_SIMULATOR_CONFIG)).toBe(cruise);
    expect(simulatedStepMeters("picked_up", DEFAULT_SIMULATOR_CONFIG)).toBe(cruise);
    expect(simulatedStepMeters("out_for_delivery", DEFAULT_SIMULATOR_CONFIG)).toBe(town);
    expect(town).toBeLessThan(cruise);
  });
});

describe("nextSimulatedPosition", () => {
  it("starts at the beginning of the route when there is no position yet", () => {
    const next = nextSimulatedPosition(route, null, 8_000);

    expect(next.distanceM).toBe(8_000);
    expect(next.point.lng).toBe(5);
    expect(haversineMeters({ lat: 50, lng: 5 }, next.point)).toBeCloseTo(8_000, -1);
  });

  it("moves one step beyond the last position, which it first projects onto the route", () => {
    // 20 km up the meridian, but reported 3 km to the east: off the road, projected back onto it.
    const last = { lat: 50 + 20_000 / 111_195, lng: 5.04 };
    const next = nextSimulatedPosition(route, last, 8_000);

    expect(next.distanceM).toBeCloseTo(28_000, -2);
    expect(next.point.lng).toBe(5); // on the route, whatever the last position was
    expect(haversineMeters({ lat: 50, lng: 5 }, next.point)).toBeCloseTo(28_000, -2);
  });

  it("walks the route in order, ping after ping", () => {
    let position: { lat: number; lng: number } | null = null;
    const distances: number[] = [];
    for (let i = 0; i < 4; i++) {
      const next = nextSimulatedPosition(route, position, 8_000);
      distances.push(next.distanceM);
      position = next.point;
    }
    expect(distances[0]).toBe(8_000);
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]! - distances[i - 1]!).toBeCloseTo(8_000, -1);
    }
  });

  it("stops at the end of the route and stays there", () => {
    const nearEnd = { lat: 50.99, lng: 5 };
    const arrived = nextSimulatedPosition(route, nearEnd, 8_000);
    expect(arrived.distanceM).toBe(route.lengthM);
    expect(arrived.point).toEqual({ lat: 51, lng: 5 });

    expect(nextSimulatedPosition(route, arrived.point, 8_000).point).toEqual({ lat: 51, lng: 5 });
  });

  it("never moves backwards, whatever the step", () => {
    const last = { lat: 50.3, lng: 5 };
    expect(nextSimulatedPosition(route, last, -5_000).point).toEqual({ lat: 50.3, lng: 5 });
  });

  it("rounds to about a metre, like the simulator", () => {
    expect(roundDegrees(51.123456789)).toBe(51.12346);
    const { point } = nextSimulatedPosition(route, null, 1_234);
    expect(point.lat).toBe(roundDegrees(point.lat));
  });
});
