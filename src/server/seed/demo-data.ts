import type { ServiceLevel } from "@/domain/service-level";
import { isLocationSharingStatus } from "@/domain/location-sharing";
import { isTerminalStatus, type ShipmentStatus } from "@/domain/shipment-status";
import { createRandom, type Random } from "@/lib/random";

/**
 * The demo data for "Demo Freight Co", drafted as plain values: no I/O. `seedDemo` applies a
 * draft through the real services; the route fixture script and its coverage test read the city
 * pairs from it. Every random choice comes from one deterministic PRNG, drawn in a fixed order, so
 * every seeded database looks the same (apart from times, which are relative to `now`).
 */

export type City = {
  city: string;
  country: string;
  postalCode: string;
  address: string;
  lat: number;
  lng: number;
};

export const CITIES: readonly City[] = [
  {
    city: "Rotterdam",
    country: "NL",
    postalCode: "3072 AP",
    address: "Wilhelminakade 88",
    lat: 51.9055,
    lng: 4.4886,
  },
  {
    city: "Amsterdam",
    country: "NL",
    postalCode: "1011 AC",
    address: "Prins Hendrikkade 33",
    lat: 52.3779,
    lng: 4.8999,
  },
  {
    city: "Utrecht",
    country: "NL",
    postalCode: "3511 CE",
    address: "Stationsplein 10",
    lat: 52.0894,
    lng: 5.1101,
  },
  {
    city: "Eindhoven",
    country: "NL",
    postalCode: "5611 AD",
    address: "Stationsweg 2",
    lat: 51.4433,
    lng: 5.4797,
  },
  {
    city: "Antwerp",
    country: "BE",
    postalCode: "2000",
    address: "Meir 50",
    lat: 51.2181,
    lng: 4.4085,
  },
  {
    city: "Brussels",
    country: "BE",
    postalCode: "1000",
    address: "Rue Neuve 111",
    lat: 50.8519,
    lng: 4.3571,
  },
  {
    city: "Ghent",
    country: "BE",
    postalCode: "9000",
    address: "Korenmarkt 16",
    lat: 51.0543,
    lng: 3.7207,
  },
  {
    city: "Cologne",
    country: "DE",
    postalCode: "50667",
    address: "Hohe Strasse 52",
    lat: 50.9384,
    lng: 6.9583,
  },
  {
    city: "Düsseldorf",
    country: "DE",
    postalCode: "40212",
    address: "Königsallee 60",
    lat: 51.2254,
    lng: 6.7782,
  },
  {
    city: "Hamburg",
    country: "DE",
    postalCode: "20457",
    address: "Am Sandtorkai 41",
    lat: 53.5438,
    lng: 9.9888,
  },
  {
    city: "Lille",
    country: "FR",
    postalCode: "59000",
    address: "Rue Faidherbe 25",
    lat: 50.6365,
    lng: 3.0635,
  },
  {
    city: "Paris",
    country: "FR",
    postalCode: "75010",
    address: "Rue de Dunkerque 18",
    lat: 48.8809,
    lng: 2.3553,
  },
  {
    city: "Luxembourg",
    country: "LU",
    postalCode: "1611",
    address: "Avenue de la Gare 41",
    lat: 49.6,
    lng: 6.1333,
  },
];

const RECIPIENTS = [
  "Sanne de Vries",
  "Lucas Peeters",
  "Emma Janssen",
  "Noah Müller",
  "Julie Lambert",
  "Daan Bakker",
  "Lena Schmidt",
  "Louis Dubois",
  "Fleur Visser",
  "Jonas Weber",
  "Camille Laurent",
  "Bram Maes",
];

const PUBLIC_NOTES: Partial<Record<ShipmentStatus, readonly string[]>> = {
  picked_up: ["Collected from the sender", "Picked up at the warehouse dock"],
  in_transit: ["On the way to the regional hub", "Departed the sorting centre"],
  out_for_delivery: ["On the delivery vehicle", "Expected between 13:00 and 17:00"],
  delivered: ["Delivered to the recipient", "Left at reception, signed by the front desk"],
  exception: ["Delayed by a road closure", "Recipient not available, a new attempt is planned"],
  cancelled: ["Cancelled at the sender's request"],
};

const INTERNAL_NOTES = [
  "Call ahead: loading dock closes at 16:00",
  "Fragile, keep upright",
  "Customer asked for a tail-lift truck",
  "Gate code 4411",
  "Re-routed through the Breda depot",
];

const happyPath = ["picked_up", "in_transit", "out_for_delivery", "delivered"] as const;
const repeat = (count: number, path: readonly ShipmentStatus[]) =>
  Array.from({ length: count }, () => path);

/** The statuses each shipment moves through after `created`: 30 shipments, every status. */
const PLANS: readonly (readonly ShipmentStatus[])[] = [
  ...repeat(5, []),
  ...repeat(4, happyPath.slice(0, 1)),
  ...repeat(6, happyPath.slice(0, 2)),
  ...repeat(4, happyPath.slice(0, 3)),
  ...repeat(5, happyPath),
  ["picked_up", "in_transit", "exception", "in_transit", "out_for_delivery", "delivered"],
  ...repeat(2, ["picked_up", "in_transit", "exception"]),
  ["picked_up", "exception"],
  ["cancelled"],
  ["picked_up", "exception", "cancelled"],
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** The PRNG seed of the demo data. Changing it changes every seeded shipment. */
const DEMO_RANDOM_SEED = 2026;

/** One status change of a drafted shipment, with what the seed records for it. */
export type DraftStep = {
  toStatus: ShipmentStatus;
  occurredAt: Date;
  publicNote: string;
  internalNote: string;
  /** Where it happened: the pickup city before delivery starts, the delivery city after. */
  place: City;
};

export type DraftShipment = {
  index: number;
  origin: City;
  destination: City;
  serviceLevel: ServiceLevel;
  /** Driven by the demo driver (half of the shipments that leave the depot). */
  assignedToDemoDriver: boolean;
  reference: string;
  recipientName: string;
  recipientEmail: string;
  weightKg: number;
  createdAt: Date;
  promisedDeliveryAt: Date;
  steps: DraftStep[];
  /**
   * The demo driver's last location fix, recorded right after step `afterStep`: `progress` is how
   * far along the route (0 to 1) the truck was. Null when the shipment has no position.
   */
  lastPing: { afterStep: number; at: Date; progress: number } | null;
};

/** The 30 demo shipments, oldest booking decisions first, relative to `now`. */
export function draftDemoShipments(now: Date): DraftShipment[] {
  const random = createRandom(DEMO_RANDOM_SEED);
  return PLANS.map((plan, index) => draftShipment(index, plan, random, now));
}

/** The distinct pickup and delivery city pairs of the demo shipments, in first-use order. */
export function demoCityPairs(): { origin: City; destination: City }[] {
  const pairs = new Map<string, { origin: City; destination: City }>();
  for (const { origin, destination } of draftDemoShipments(new Date(0))) {
    pairs.set(`${origin.city}->${destination.city}`, { origin, destination });
  }
  return [...pairs.values()];
}

/**
 * The draws happen in exactly this order (they used to be interleaved with the service calls), so
 * reordering them would change every seeded shipment after the first.
 */
function draftShipment(
  index: number,
  plan: readonly ShipmentStatus[],
  random: Random,
  now: Date,
): DraftShipment {
  const origin = random.pick(CITIES);
  const destination = random.pick(CITIES.filter((city) => city !== origin));
  const serviceLevel = random.pick<ServiceLevel>(["standard", "standard", "express", "same_day"]);
  const assignedToDemoDriver = plan[0] === "picked_up" && index % 2 === 0;

  // Event times: hours apart, oldest first, all in the past. Booked up to a few days ago.
  const gaps = plan.map(() => random.between(2, 14) * HOUR);
  const historyLength = gaps.reduce((sum, gap) => sum + gap, 0);
  const createdAt = roundToMinute(
    new Date(now.getTime() - historyLength - random.between(1, plan.length ? 30 : 72) * HOUR),
  );
  const promisedDeliveryAt = promisedDelivery({
    finished: isTerminalStatus(plan.at(-1) ?? "created"),
    overdue: OVERDUE_SHIPMENTS.has(index),
    serviceLevel,
    createdAt,
    now,
  });

  const reference = random.chance(0.75) ? `PO-${48100 + index * 37}` : "";
  const recipientName = random.pick(RECIPIENTS);
  const recipientEmail = random.chance(0.5) ? `customer${index + 1}@example.com` : "";
  const weightKg = Math.round(random.between(0.5, 1200) * 10) / 10;

  // Real-world times of each step, oldest first.
  const times: Date[] = [];
  for (const gap of gaps)
    times.push(roundToMinute(new Date((times.at(-1) ?? createdAt).getTime() + gap)));

  const steps = plan.map((toStatus, step): DraftStep => {
    const publicNote = random.chance(0.8) ? random.pick(PUBLIC_NOTES[toStatus] ?? [""]) : "";
    const internalNote = random.chance(0.3) ? random.pick(INTERNAL_NOTES) : "";
    const place =
      toStatus === "out_for_delivery" || toStatus === "delivered" ? destination : origin;
    return { toStatus, occurredAt: times[step]!, publicNote, internalNote, place };
  });

  return {
    index,
    origin,
    destination,
    serviceLevel,
    assignedToDemoDriver,
    reference,
    recipientName,
    recipientEmail,
    weightKg,
    createdAt,
    promisedDeliveryAt,
    steps,
    lastPing: lastPingMoment(plan, times, { assigned: assignedToDemoDriver, index, now }),
  };
}

const PROMISE_DAYS: Record<ServiceLevel, number> = { same_day: 0, express: 1, standard: 3 };

/**
 * The unfinished shipments that are deliberately late: one in transit and one held up by an
 * exception, both the demo driver's. Everything else still on the road is on time, so the demo
 * shows what "Overdue" looks like without looking broken.
 */
const OVERDUE_SHIPMENTS: ReadonlySet<number> = new Set([12, 26]);

/**
 * The promised delivery: 17:00 UTC, some days after booking by service level. Finished shipments
 * keep that booking-relative promise. Unfinished ones are promised relative to `now` instead (so a
 * fresh seed is on time however long ago its bookings are backdated), at least two hours ahead,
 * except the deliberately overdue ones, which were due a couple of hours ago.
 */
function promisedDelivery({
  finished,
  overdue,
  serviceLevel,
  createdAt,
  now,
}: {
  finished: boolean;
  overdue: boolean;
  serviceLevel: ServiceLevel;
  createdAt: Date;
  now: Date;
}): Date {
  if (overdue) {
    const due = new Date(Math.floor((now.getTime() - 2 * HOUR) / HOUR) * HOUR);
    if (due <= createdAt)
      throw new Error("An overdue seed shipment must be booked before its due time");
    return due;
  }
  const from = finished ? createdAt : new Date(now.getTime() + 2 * HOUR);
  const promised = new Date(from.getTime() + PROMISE_DAYS[serviceLevel] * DAY);
  promised.setUTCHours(17, 0, 0, 0);
  if (promised <= from) promised.setTime(promised.getTime() + DAY);
  return promised;
}

/**
 * When the demo driver's phone last reported an unfinished shipment, and how far along it was: a
 * few minutes ago if it is still on the road, or shortly before it ran into its exception (pings
 * stop then, and the last position is what dispatch looks at). Null for everything else.
 */
function lastPingMoment(
  plan: readonly ShipmentStatus[],
  times: readonly Date[],
  { assigned, index, now }: { assigned: boolean; index: number; now: Date },
): DraftShipment["lastPing"] {
  const last = plan.length - 1;
  if (!assigned || last < 0 || isTerminalStatus(plan[last]!)) return null;
  if (isLocationSharingStatus(plan[last]!)) {
    // Varied but deterministic (no draw from the PRNG, so the rest of the seed stays unchanged).
    return {
      afterStep: last,
      at: new Date(now.getTime() - (2 + ((index * 7) % 23)) * 60_000),
      progress: progressFor(plan[last]!, index),
    };
  }
  if (plan[last] === "exception" && last > 0 && isLocationSharingStatus(plan[last - 1]!)) {
    return {
      afterStep: last - 1,
      at: new Date(times[last]!.getTime() - 20 * 60_000),
      progress: progressFor(plan[last - 1]!, index),
    };
  }
  return null;
}

/** How far along the route a shipment in `status` was last seen. */
function progressFor(status: ShipmentStatus, index: number): number {
  if (status === "picked_up") return 0.08;
  if (status === "out_for_delivery") return 0.9;
  return 0.3 + (index % 5) * 0.1;
}

function roundToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}
