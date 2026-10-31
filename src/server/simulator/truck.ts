import type { ShipmentStatus } from "@/domain/shipment-status";
import type { Random } from "@/lib/random";

/**
 * The truck simulator's decisions, as a pure function of one truck's state: how far it moves in a
 * tick and which status change (if any) that calls for. No I/O; `simulator.ts` carries the
 * decisions out through the real services, which still enforce every rule.
 *
 * A truck follows its shipment's lifecycle the way a driver would record it:
 *
 *   created → picked_up (at the pickup) → in_transit (as it sets off) → out_for_delivery (near the
 *   delivery address, then slower city driving) → delivered (on arrival)
 *
 * Now and then a truck in transit runs into an exception (at most once per truck per run); it
 * resumes after a few ticks. The caller decides which exceptions are the truck's to clear
 * (`exceptionTicksLeft` set) and which are left for the office (null).
 */

export type SimulatorConfig = {
  /** Real time between ticks. At least the server's ping throttle, or pings are dropped. */
  tickMs: number;
  /** Simulated time per real time: 30 means a 12 s tick moves the truck 6 minutes' worth. */
  timeCompression: number;
  /** Speed on the open road. */
  cruiseKmh: number;
  /** Speed once out for delivery, in town. */
  deliveryKmh: number;
  /** Distance before the delivery address at which the truck goes out for delivery. */
  outForDeliveryM: number;
  /** Chance per tick in transit of an exception, for a truck that has not had one this run. */
  exceptionChance: number;
  /** Ticks an exception lasts before the truck carries on. */
  exceptionTicks: number;
};

export const DEFAULT_SIMULATOR_CONFIG: SimulatorConfig = {
  tickMs: 12_000,
  timeCompression: 30,
  cruiseKmh: 80,
  deliveryKmh: 35,
  outForDeliveryM: 15_000,
  exceptionChance: 0.01,
  exceptionTicks: 5,
};

export type TruckState = {
  status: ShipmentStatus;
  /** How far along its route the truck is, and the route's length, in metres. */
  distanceM: number;
  routeLengthM: number;
  /**
   * Ticks until the current exception is over and the truck carries on; null when there is no
   * exception, or it is not the truck's to clear (the office put the shipment on hold).
   */
  exceptionTicksLeft: number | null;
  /** Whether the truck already had an exception in this run (one is plenty for a demo). */
  hadException: boolean;
};

/** Where a status change happened: a stop, or wherever the truck is on its route. */
export type ActionPlace = "pickup" | "delivery" | "route";

export type TruckAction =
  /** Report the position `distanceM` along the route. */
  | { kind: "ping"; distanceM: number }
  | { kind: "status"; toStatus: ShipmentStatus; publicNote: string; place: ActionPlace }
  /** Nothing to do this tick, and why (for the log). */
  | { kind: "idle"; reason: string };

export type TruckPlan = { actions: TruckAction[]; next: TruckState };

const EXCEPTION_NOTES = [
  "Delayed by a road closure",
  "Held up in heavy traffic after an accident",
  "Waiting at the border for a document check",
] as const;

/** Metres a truck covers in one tick at `kmh`, with time compression. */
export function stepMeters(config: SimulatorConfig, kmh: number): number {
  return (kmh / 3.6) * (config.tickMs / 1000) * config.timeCompression;
}

/**
 * What a truck does in one tick. Actions run in order: a ping always comes before a status change
 * that takes the shipment off the road (out of the statuses that accept pings), and the arrival
 * ping lands exactly on the delivery address.
 */
export function planTick(state: TruckState, config: SimulatorConfig, random: Random): TruckPlan {
  const remaining = state.routeLengthM - state.distanceM;

  switch (state.status) {
    case "created":
      return {
        actions: [
          {
            kind: "status",
            toStatus: "picked_up",
            publicNote: "Collected from the sender",
            place: "pickup",
          },
          { kind: "ping", distanceM: 0 },
        ],
        next: { ...state, status: "picked_up", distanceM: 0 },
      };

    case "picked_up": {
      const distanceM = advance(state, stepMeters(config, config.cruiseKmh));
      return {
        actions: [
          { kind: "status", toStatus: "in_transit", publicNote: "On the way", place: "route" },
          { kind: "ping", distanceM },
        ],
        next: { ...state, status: "in_transit", distanceM },
      };
    }

    case "in_transit": {
      // No exception right before going out for delivery: the next tick would look odd.
      if (
        !state.hadException &&
        remaining > config.outForDeliveryM &&
        random.chance(config.exceptionChance)
      ) {
        return {
          actions: [
            {
              kind: "status",
              toStatus: "exception",
              publicNote: random.pick(EXCEPTION_NOTES),
              place: "route",
            },
          ],
          next: {
            ...state,
            status: "exception",
            exceptionTicksLeft: config.exceptionTicks,
            hadException: true,
          },
        };
      }
      const distanceM = advance(state, stepMeters(config, config.cruiseKmh));
      const actions: TruckAction[] = [{ kind: "ping", distanceM }];
      if (state.routeLengthM - distanceM > config.outForDeliveryM) {
        return { actions, next: { ...state, distanceM } };
      }
      actions.push({
        kind: "status",
        toStatus: "out_for_delivery",
        publicNote: "Out for delivery, arriving soon",
        place: "route",
      });
      return { actions, next: { ...state, status: "out_for_delivery", distanceM } };
    }

    case "out_for_delivery": {
      const distanceM = advance(state, stepMeters(config, config.deliveryKmh));
      const actions: TruckAction[] = [{ kind: "ping", distanceM }];
      if (distanceM < state.routeLengthM) return { actions, next: { ...state, distanceM } };
      actions.push({
        kind: "status",
        toStatus: "delivered",
        publicNote: "Delivered to reception",
        place: "delivery",
      });
      return { actions, next: { ...state, status: "delivered", distanceM } };
    }

    case "exception": {
      if (state.exceptionTicksLeft === null) {
        return {
          actions: [{ kind: "idle", reason: "exception left for the office" }],
          next: state,
        };
      }
      if (state.exceptionTicksLeft > 1) {
        return {
          actions: [{ kind: "idle", reason: "waiting out the exception" }],
          next: { ...state, exceptionTicksLeft: state.exceptionTicksLeft - 1 },
        };
      }
      const toStatus = remaining > config.outForDeliveryM ? "in_transit" : "out_for_delivery";
      return {
        actions: [
          {
            kind: "status",
            toStatus,
            publicNote: "Back on the road after the delay",
            place: "route",
          },
          { kind: "ping", distanceM: state.distanceM },
        ],
        next: { ...state, status: toStatus, exceptionTicksLeft: null },
      };
    }

    case "delivered":
    case "cancelled":
      return { actions: [{ kind: "idle", reason: "finished" }], next: state };
  }
}

function advance(state: TruckState, meters: number): number {
  return Math.min(state.routeLengthM, state.distanceM + meters);
}
