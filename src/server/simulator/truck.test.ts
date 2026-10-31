import { describe, expect, it } from "vitest";

import { isLocationSharingStatus } from "@/domain/location-sharing";
import { canSetStatus } from "@/domain/shipment-permissions";
import { canTransition, isTerminalStatus } from "@/domain/shipment-status";
import { createRandom, type Random } from "@/lib/random";

import {
  DEFAULT_SIMULATOR_CONFIG,
  planTick,
  stepMeters,
  type SimulatorConfig,
  type TruckState,
} from "./truck";

const config: SimulatorConfig = { ...DEFAULT_SIMULATOR_CONFIG, exceptionChance: 0 };
const truck = (overrides: Partial<TruckState> = {}): TruckState => ({
  status: "in_transit",
  distanceM: 0,
  routeLengthM: 100_000,
  exceptionTicksLeft: null,
  hadException: false,
  ...overrides,
});
/** A PRNG stand-in whose `chance` always says yes or always says no. */
const always = (yes: boolean): Random => ({ ...createRandom(1), chance: () => yes });

describe("stepMeters", () => {
  it("covers a few kilometres per tick with the defaults, so movement shows on the map", () => {
    // 80 km/h for 12 s at 30x is 8 km.
    expect(stepMeters(DEFAULT_SIMULATOR_CONFIG, 80)).toBeCloseTo(8_000);
    expect(DEFAULT_SIMULATOR_CONFIG.tickMs).toBeGreaterThan(10_000);
  });
});

describe("planTick", () => {
  const random = always(false);
  const cruise = stepMeters(config, config.cruiseKmh);
  const city = stepMeters(config, config.deliveryKmh);

  it("picks up an assigned shipment at the pickup and reports its position there", () => {
    const plan = planTick(truck({ status: "created" }), config, random);
    expect(plan.actions).toEqual([
      expect.objectContaining({ kind: "status", toStatus: "picked_up", place: "pickup" }),
      { kind: "ping", distanceM: 0 },
    ]);
    expect(plan.next.status).toBe("picked_up");
  });

  it("sets off once picked up: in transit, then moving", () => {
    const plan = planTick(truck({ status: "picked_up", distanceM: 2_000 }), config, random);
    expect(plan.actions).toEqual([
      expect.objectContaining({ kind: "status", toStatus: "in_transit" }),
      { kind: "ping", distanceM: 2_000 + cruise },
    ]);
    expect(plan.next).toMatchObject({ status: "in_transit", distanceM: 2_000 + cruise });
  });

  it("moves along the route in transit", () => {
    const plan = planTick(truck({ distanceM: 10_000 }), config, random);
    expect(plan.actions).toEqual([{ kind: "ping", distanceM: 10_000 + cruise }]);
    expect(plan.next.distanceM).toBe(10_000 + cruise);
  });

  it("goes out for delivery once near the destination, after reporting the position", () => {
    const plan = planTick(
      truck({ distanceM: 100_000 - config.outForDeliveryM - 1 }),
      config,
      random,
    );
    expect(plan.actions.map((action) => action.kind)).toEqual(["ping", "status"]);
    expect(plan.actions[1]).toMatchObject({ toStatus: "out_for_delivery" });
    expect(plan.next.status).toBe("out_for_delivery");
  });

  it("drives slower out for delivery, and delivers on arrival with a ping at the address", () => {
    const moving = planTick(
      truck({ status: "out_for_delivery", distanceM: 80_000 }),
      config,
      random,
    );
    expect(moving.actions).toEqual([{ kind: "ping", distanceM: 80_000 + city }]);

    const arriving = planTick(
      truck({ status: "out_for_delivery", distanceM: 100_000 - 10 }),
      config,
      random,
    );
    expect(arriving.actions).toEqual([
      { kind: "ping", distanceM: 100_000 },
      {
        kind: "status",
        toStatus: "delivered",
        publicNote: "Delivered to reception",
        place: "delivery",
      },
    ]);
    expect(arriving.next.status).toBe("delivered");
  });

  it("raises at most one exception per truck, and never just before delivery", () => {
    const plan = planTick(truck({ distanceM: 10_000 }), config, always(true));
    expect(plan.actions).toEqual([
      expect.objectContaining({ kind: "status", toStatus: "exception", place: "route" }),
    ]);
    expect(plan.next).toMatchObject({
      status: "exception",
      exceptionTicksLeft: config.exceptionTicks,
      hadException: true,
      distanceM: 10_000,
    });

    const again = planTick(truck({ distanceM: 10_000, hadException: true }), config, always(true));
    expect(again.actions).toEqual([{ kind: "ping", distanceM: 10_000 + cruise }]);

    const nearlyThere = planTick(truck({ distanceM: 90_000 }), config, always(true));
    expect(nearlyThere.actions.map((action) => action.kind)).toEqual(["ping", "status"]);
  });

  it("waits out its own exception, then carries on from where it stopped", () => {
    let state = truck({
      status: "exception",
      distanceM: 30_000,
      exceptionTicksLeft: 3,
      hadException: true,
    });
    for (let tick = 0; tick < 2; tick++) {
      const plan = planTick(state, config, random);
      expect(plan.actions).toEqual([{ kind: "idle", reason: "waiting out the exception" }]);
      state = plan.next;
    }
    const resumed = planTick(state, config, random);
    expect(resumed.actions).toEqual([
      expect.objectContaining({ kind: "status", toStatus: "in_transit" }),
      { kind: "ping", distanceM: 30_000 },
    ]);
    expect(resumed.next).toMatchObject({ status: "in_transit", exceptionTicksLeft: null });
  });

  it("resumes straight into delivery when the exception happened close to the address", () => {
    const plan = planTick(
      truck({ status: "exception", distanceM: 95_000, exceptionTicksLeft: 1, hadException: true }),
      config,
      random,
    );
    expect(plan.actions[0]).toMatchObject({ toStatus: "out_for_delivery" });
  });

  it("leaves exceptions it did not raise, and finished shipments, alone", () => {
    expect(planTick(truck({ status: "exception" }), config, random).actions).toEqual([
      { kind: "idle", reason: "exception left for the office" },
    ]);
    for (const status of ["delivered", "cancelled"] as const) {
      expect(planTick(truck({ status }), config, random).actions).toEqual([
        { kind: "idle", reason: "finished" },
      ]);
    }
  });

  it("only ever plans transitions a driver may make, with pings only while on the road", () => {
    // Drive a whole route with frequent exceptions; check every planned step against the rules.
    const seeded = createRandom(42);
    const lively = { ...config, exceptionChance: 0.3 };
    let state = truck({ status: "created", routeLengthM: 250_000 });
    for (let tick = 0; tick < 500 && !isTerminalStatus(state.status); tick++) {
      let status = state.status;
      const plan = planTick(state, lively, seeded);
      for (const action of plan.actions) {
        if (action.kind === "status") {
          expect(canTransition(status, action.toStatus)).toBe(true);
          expect(canSetStatus("driver", action.toStatus)).toBe(true);
          status = action.toStatus;
        }
        if (action.kind === "ping") {
          expect(isLocationSharingStatus(status)).toBe(true);
          expect(action.distanceM).toBeLessThanOrEqual(state.routeLengthM);
        }
      }
      expect(plan.next.status).toBe(status);
      expect(plan.next.distanceM).toBeGreaterThanOrEqual(state.distanceM);
      state = plan.next;
    }
    expect(state.status).toBe("delivered");
    expect(state.distanceM).toBe(250_000);
  });
});
