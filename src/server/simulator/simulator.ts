import "server-only";

import { isLocationSharingStatus } from "@/domain/location-sharing";
import type { LatLng } from "@/lib/geo";
import type { Random } from "@/lib/random";
import { distanceAlong, measureRoute, pointAlong, type MeasuredRoute } from "@/lib/route-geometry";
import type { AuthContext } from "@/server/auth/auth-context";
import type { Shipment } from "@/server/db/schema";
import { roadRoutes, routeBetween } from "@/server/routes/road-routes";
import { assignDriver } from "@/server/services/assign-driver";
import { changeShipmentStatus } from "@/server/services/change-shipment-status";
import { createShipment } from "@/server/services/create-shipment";
import { getShipment } from "@/server/services/get-shipment";
import { getShipmentPositions } from "@/server/services/get-shipment-positions";
import { listAssignedShipments } from "@/server/services/list-assigned-shipments";
import { recordLocationPing } from "@/server/services/record-location-ping";

import {
  bookablePairs,
  DEFAULT_REFILL,
  draftBooking,
  planRefill,
  type Booking,
  type RefillConfig,
} from "./booking";
import {
  DEFAULT_SIMULATOR_CONFIG,
  planTick,
  type ActionPlace,
  type SimulatorConfig,
  type TruckAction,
  type TruckState,
} from "./truck";

/**
 * The truck simulator: drives shipments as their assigned drivers, through the same services the
 * driver app uses (`recordLocationPing`, `changeShipmentStatus`). So every rule applies to it as
 * to a person: the state machine, the driver's permissions, the 10 s ping throttle, event-time
 * ordering, history entries and realtime announcements. It writes nothing any other way.
 *
 * Each `tick()` re-reads the drivers' assigned shipments, plans one step per truck with the pure
 * `planTick` and carries it out. Only the distance along each route (and the countdown of an
 * exception) is remembered between ticks; statuses and versions always come fresh from the
 * database, so a dispatcher can change a shipment while the simulator runs. A truck seen for the
 * first time starts from its last known position, projected onto its route.
 *
 * Exceptions: one the driver recorded (the simulator's own, also from an earlier run, or the
 * seed's) is the driver's to clear, so the truck carries on after `exceptionTicks`. One the office
 * recorded is a hold: the simulator leaves it alone until the office moves the shipment on.
 *
 * Refill (optional): when a tick leaves fewer drivable shipments than `target`, the simulator
 * books replacements as the demo dispatcher, through `createShipment` and `assignDriver`, between
 * cities that have a committed road route, assigned to the first driver. The next tick picks them
 * up like any assigned booking. At most `maxPerTick` per tick, so the fleet refills gradually.
 */

export type SimulatorOptions = {
  /**
   * The drivers to drive as. Their assigned, unfinished shipments are the trucks. A function is
   * called at the start of every tick, for a caller whose drivers can change between ticks (the
   * hosted demo is recreated every night).
   */
  drivers: readonly AuthContext[] | (() => Promise<readonly AuthContext[]>);
  random: Random;
  config?: Partial<SimulatorConfig>;
  /**
   * Book new work when the fleet runs low (off when omitted). Needs the office account to book as
   * (a function is called when a booking is due, for a caller whose accounts can change between
   * ticks) and at least one driver to assign to.
   */
  refill?: Partial<RefillConfig> & {
    dispatcher: AuthContext | (() => Promise<AuthContext>);
  };
  /** At most this many trucks per tick (the first by tracking code). */
  maxShipments?: number;
  /** The clock for device and server times; injectable for tests. */
  clock?: () => Date;
  log?: (line: string) => void;
};

/** One action carried out, and what the service said. */
export type SimulatorEvent = {
  shipmentId: string;
  trackingCode: string;
  action: TruckAction;
  /** "ok", "throttled", or the reason a service refused (conflict, invalid_transition, …). */
  outcome: string;
};

export type TickReport = {
  /** Trucks driven this tick. */
  driven: number;
  events: SimulatorEvent[];
  /**
   * Shipments still to drive after this tick (including any beyond `maxShipments`, and the ones
   * booked by this tick's refill).
   */
  remaining: number;
  /** Tracking codes of the shipments this tick's refill booked. */
  booked: string[];
};

/** What the simulator remembers about a truck between ticks. */
type TruckMemory = {
  route: MeasuredRoute;
  distanceM: number;
  exceptionTicksLeft: number | null;
  hadException: boolean;
};

type Truck = {
  driver: AuthContext;
  shipment: Shipment;
  lastPosition: LatLng | null;
  /** In an exception that this truck's driver recorded (not the office). */
  driverException: boolean;
};

export function createSimulator(options: SimulatorOptions) {
  const config: SimulatorConfig = { ...DEFAULT_SIMULATOR_CONFIG, ...options.config };
  const clock = options.clock ?? (() => new Date());
  const log = options.log ?? (() => {});
  const memory = new Map<string, TruckMemory>();
  /** Trucks the log already said it skips, so the reason is not repeated every tick. */
  const skipNoted = new Set<string>();

  /** Drivable: coordinates to follow, and on its way or in an exception the driver recorded. */
  function drivable({ shipment, driverException }: Truck): boolean {
    if (stopsOf(shipment) === null) return false;
    if (shipment.status === "exception") return driverException;
    return shipment.status === "created" || isLocationSharingStatus(shipment.status);
  }

  function noteSkipped(truck: Truck, now: Date, why: string): void {
    if (skipNoted.has(truck.shipment.id)) return;
    skipNoted.add(truck.shipment.id);
    log(`${timeOf(now)} ${truck.shipment.trackingCode}  skipped: ${why}`);
  }

  async function tick(): Promise<TickReport> {
    const now = clock();
    const drivers =
      typeof options.drivers === "function" ? await options.drivers() : options.drivers;
    const trucks = await loadTrucks(drivers);
    const candidates: Truck[] = [];
    for (const truck of trucks) {
      if (drivable(truck)) candidates.push(truck);
      else if (stopsOf(truck.shipment) === null)
        noteSkipped(truck, now, "no pickup/delivery coordinates");
      else if (truck.shipment.status === "exception")
        noteSkipped(truck, now, "exception left for the office");
    }
    const selected = candidates.slice(0, options.maxShipments ?? candidates.length);

    const events: SimulatorEvent[] = [];
    let finished = 0;
    for (const truck of selected) {
      const outcome = await driveTruck(truck, now, events);
      if (outcome === "delivered") finished++;
    }
    const stillDrivable = candidates.length - finished;
    const booked = await refill(drivers, stillDrivable, now);
    return {
      driven: selected.length,
      events,
      remaining: stillDrivable + booked.length,
      booked,
    };
  }

  /**
   * Books replacements when fewer than `target` shipments are left to drive. A refused booking
   * (say the office account lost its role) is logged and ends the refill for this tick.
   */
  async function refill(
    drivers: readonly AuthContext[],
    drivable: number,
    now: Date,
  ): Promise<string[]> {
    const refillOptions = options.refill;
    const driver = drivers[0];
    if (!refillOptions || !driver) return [];
    const count = planRefill(drivable, { ...DEFAULT_REFILL, ...definedOnly(refillOptions) });
    if (count === 0) return [];

    const dispatcher =
      typeof refillOptions.dispatcher === "function"
        ? await refillOptions.dispatcher()
        : refillOptions.dispatcher;
    const pairs = bookablePairs(roadRoutes());
    const booked: string[] = [];
    for (let i = 0; i < count; i++) {
      const booking = draftBooking(options.random, now, pairs);
      const result = await book(dispatcher, driver, booking, now);
      if (!result.ok) {
        log(`${timeOf(now)} booking refused: ${result.reason}`);
        break;
      }
      booked.push(result.trackingCode);
      log(
        `${timeOf(now)} ${result.trackingCode}  booked ${booking.origin.city} → ${booking.destination.city}, assigned to the driver`,
      );
    }
    return booked;
  }

  async function driveTruck(
    { driver, shipment, lastPosition, driverException }: Truck,
    now: Date,
    events: SimulatorEvent[],
  ): Promise<"delivered" | "ongoing"> {
    const stops = stopsOf(shipment)!;
    const remembered = memory.get(shipment.id);
    const route =
      remembered?.route ?? measureRoute(routeBetween(stops.origin, stops.destination).line);
    const state: TruckState = {
      status: shipment.status,
      distanceM: remembered?.distanceM ?? (lastPosition ? distanceAlong(route, lastPosition) : 0),
      routeLengthM: route.lengthM,
      // A driver's exception first seen now (an earlier run's, or the seed's) gets a fresh countdown.
      exceptionTicksLeft: driverException
        ? (remembered?.exceptionTicksLeft ?? config.exceptionTicks)
        : null,
      hadException: remembered?.hadException ?? shipment.status === "exception",
    };

    const plan = planTick(state, config, options.random);
    let version = shipment.version;
    let distanceM = state.distanceM;
    for (const action of plan.actions) {
      const record = (outcome: string) => {
        events.push({
          shipmentId: shipment.id,
          trackingCode: shipment.trackingCode,
          action,
          outcome,
        });
        log(`${timeOf(now)} ${shipment.trackingCode}  ${describe(action, route)}  ${outcome}`);
      };

      if (action.kind === "idle") {
        record("idle");
        continue;
      }

      if (action.kind === "ping") {
        distanceM = action.distanceM;
        const point = pointAlong(route, distanceM);
        const result = await recordLocationPing(
          driver,
          {
            shipmentId: shipment.id,
            lat: round(point.lat),
            lng: round(point.lng),
            accuracyM: 10,
            recordedAt: now,
          },
          { now: () => now },
        );
        // Throttled is fine: the truck still moved, and the next accepted ping reports it.
        const outcome = !result.ok ? result.reason : result.accepted ? "ok" : result.reason;
        record(outcome);
        if (!result.ok) return "ongoing"; // Re-read and re-plan next tick.
        continue;
      }

      const place = placeOf(action.place, stops, pointAlong(route, distanceM));
      const result = await changeShipmentStatus(driver, {
        shipmentId: shipment.id,
        expectedVersion: version,
        toStatus: action.toStatus,
        occurredAt: now,
        publicNote: action.publicNote,
        location: place,
      });
      record(result.ok ? "ok" : result.reason);
      // A dispatcher may have changed the shipment meanwhile: keep the old memory and re-plan
      // from the fresh status next tick.
      if (!result.ok) return "ongoing";
      version = result.shipment.version;
    }

    memory.set(shipment.id, {
      route,
      distanceM: plan.next.distanceM,
      exceptionTicksLeft: plan.next.exceptionTicksLeft,
      hadException: plan.next.hadException,
    });
    return plan.next.status === "delivered" ? "delivered" : "ongoing";
  }

  return { tick, config };
}

export type Simulator = ReturnType<typeof createSimulator>;

/** Books one shipment and assigns the driver, as the office would in the app. */
async function book(
  dispatcher: AuthContext,
  driver: AuthContext,
  booking: Booking,
  now: Date,
): Promise<{ ok: true; trackingCode: string } | { ok: false; reason: string }> {
  const { origin, destination } = booking;
  const created = await createShipment(
    dispatcher,
    {
      reference: booking.reference,
      recipientName: booking.recipientName,
      originAddressLine: origin.address,
      originCity: origin.city,
      originPostalCode: origin.postalCode,
      originCountry: origin.country,
      originLat: origin.lat,
      originLng: origin.lng,
      destinationAddressLine: destination.address,
      destinationCity: destination.city,
      destinationPostalCode: destination.postalCode,
      destinationCountry: destination.country,
      destinationLat: destination.lat,
      destinationLng: destination.lng,
      weightKg: booking.weightKg,
      serviceLevel: booking.serviceLevel,
      promisedDeliveryAt: booking.promisedDeliveryAt,
    },
    { now: () => now },
  );
  if (!created.ok) return { ok: false, reason: created.reason };
  const assigned = await assignDriver(dispatcher, {
    shipmentId: created.shipment.id,
    expectedVersion: created.shipment.version,
    driverId: driver.userId,
  });
  if (!assigned.ok) return { ok: false, reason: assigned.reason };
  return { ok: true, trackingCode: created.shipment.trackingCode };
}

/** The refill numbers the caller set, without the keys left undefined. */
function definedOnly({ target, maxPerTick }: Partial<RefillConfig>): Partial<RefillConfig> {
  return {
    ...(target === undefined ? {} : { target }),
    ...(maxPerTick === undefined ? {} : { maxPerTick }),
  };
}

/**
 * Every driver's unfinished assigned shipments, each read in full (status, version, stops) with
 * the driver's own context, plus its last known position. Ordered by tracking code, so runs with
 * the same data and seed make the same choices.
 */
async function loadTrucks(drivers: readonly AuthContext[]): Promise<Truck[]> {
  const trucks: Truck[] = [];
  for (const driver of drivers) {
    const { active } = await listAssignedShipments(driver);
    if (active.length === 0) continue;
    const positions = await getShipmentPositions(driver, { shipmentIds: active.map((s) => s.id) });
    const positionOf = new Map(
      positions.ok
        ? positions.positions.map((p) => [p.shipmentId, { lat: p.lat, lng: p.lng }])
        : [],
    );
    for (const { id } of active) {
      const result = await getShipment(driver, id);
      if (!result.ok) continue;
      const latestStatusEvent = result.events.findLast((event) => event.toStatus !== null);
      trucks.push({
        driver,
        shipment: result.shipment,
        lastPosition: positionOf.get(id) ?? null,
        driverException:
          result.shipment.status === "exception" &&
          latestStatusEvent?.actorUserId === driver.userId,
      });
    }
  }
  return trucks.sort((a, b) => a.shipment.trackingCode.localeCompare(b.shipment.trackingCode));
}

type Stops = { origin: LatLng & { city: string }; destination: LatLng & { city: string } };

function stopsOf(shipment: Shipment): Stops | null {
  const { originLat, originLng, destinationLat, destinationLng } = shipment;
  if (
    originLat === null ||
    originLng === null ||
    destinationLat === null ||
    destinationLng === null
  ) {
    return null;
  }
  return {
    origin: { lat: originLat, lng: originLng, city: shipment.originCity },
    destination: { lat: destinationLat, lng: destinationLng, city: shipment.destinationCity },
  };
}

/** The status event's location: the stop's city, or the coordinates on the road (no city). */
function placeOf(place: ActionPlace, stops: Stops, onRoute: LatLng) {
  if (place === "pickup") return stops.origin;
  if (place === "delivery") return stops.destination;
  return { lat: round(onRoute.lat), lng: round(onRoute.lng) };
}

function describe(action: TruckAction, route: MeasuredRoute): string {
  if (action.kind === "idle") return action.reason;
  if (action.kind === "ping") {
    const km = (metres: number) => Math.round(metres / 1000);
    return `ping ${km(action.distanceM)}/${km(route.lengthM)} km`;
  }
  return `→ ${action.toStatus} "${action.publicNote}"`;
}

const round = (degrees: number) => Math.round(degrees * 1e5) / 1e5;
const timeOf = (date: Date) => date.toISOString().slice(11, 19);
