import type { ServiceLevel } from "@/domain/service-level";
import type { Random } from "@/lib/random";
import type { RoadRoute } from "@/server/routes/road-route-fixture";
import { CITIES, PROMISE_DAYS, RECIPIENTS, type City } from "@/server/seed/demo-data";

/**
 * What the simulator books when the demo runs low on unfinished work. Pure: no I/O. The wiring in
 * `simulator.ts` turns a `Booking` into `createShipment` and `assignDriver` calls.
 */

export type RefillConfig = {
  /** Book replacements while fewer shipments than this are unfinished. */
  target: number;
  /** At most this many bookings in one tick, so the fleet refills gradually. */
  maxPerTick: number;
};

export const DEFAULT_REFILL: RefillConfig = { target: 6, maxPerTick: 2 };

/**
 * How many shipments to book now: enough to reach `target`, never more than `maxPerTick`, never
 * negative. `unfinished` is what is still on its way after this tick's driving.
 */
export function planRefill(unfinished: number, config: RefillConfig): number {
  const missing = Math.max(0, config.target - unfinished);
  return Math.min(missing, Math.max(0, config.maxPerTick));
}

export type CityPair = { origin: City; destination: City; distanceM: number };

/**
 * Routes longer than this are not booked: at the default speed a truck covers about 8 km per
 * tick, so a 300 km route is a trip of around 40 ticks (8 minutes of someone watching), and the
 * map shows deliveries instead of trucks that never arrive.
 */
export const MAX_BOOKED_ROUTE_M = 300_000;

/**
 * The city pairs a booking may use: those with a committed road route (so the truck follows real
 * roads) and a known address on both ends, in fixture order.
 */
export function bookablePairs(
  routes: readonly RoadRoute[],
  cities: readonly City[] = CITIES,
  maxDistanceM = MAX_BOOKED_ROUTE_M,
): CityPair[] {
  const byName = new Map(cities.map((city) => [city.city, city]));
  const pairs: CityPair[] = [];
  for (const route of routes) {
    const origin = byName.get(route.from.city);
    const destination = byName.get(route.to.city);
    if (origin && destination && route.distanceM <= maxDistanceM) {
      pairs.push({ origin, destination, distanceM: route.distanceM });
    }
  }
  return pairs;
}

/** Everything `createShipment` needs, as plain values. */
export type Booking = {
  origin: City;
  destination: City;
  recipientName: string;
  reference: string;
  weightKg: number;
  serviceLevel: ServiceLevel;
  promisedDeliveryAt: Date;
};

/**
 * One drafted booking, every choice drawn from `random` in a fixed order, so the same seed and
 * the same ticks book the same shipments. The promise is 17:00 UTC a service-level number of days
 * out, and at least two hours ahead of `now`, so a new booking is never born late.
 */
export function draftBooking(random: Random, now: Date, pairs: readonly CityPair[]): Booking {
  const { origin, destination } = random.pick(pairs);
  const serviceLevel = random.pick<ServiceLevel>(["standard", "standard", "express", "same_day"]);
  const reference = random.chance(0.75) ? `PO-${Math.floor(random.between(48000, 99999))}` : "";
  const recipientName = random.pick(RECIPIENTS);
  const weightKg = Math.round(random.between(0.5, 1200) * 10) / 10;
  return {
    origin,
    destination,
    recipientName,
    reference,
    weightKg,
    serviceLevel,
    promisedDeliveryAt: promisedAfter(now, serviceLevel),
  };
}

const HOUR = 60 * 60 * 1000;

function promisedAfter(now: Date, serviceLevel: ServiceLevel): Date {
  const earliest = new Date(now.getTime() + 2 * HOUR);
  const promised = new Date(earliest.getTime() + PROMISE_DAYS[serviceLevel] * 24 * HOUR);
  promised.setUTCHours(17, 0, 0, 0);
  if (promised <= earliest) promised.setTime(promised.getTime() + 24 * HOUR);
  return promised;
}
