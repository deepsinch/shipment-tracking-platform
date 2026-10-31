import "server-only";

import { eq } from "drizzle-orm";

import { isLocationSharingStatus } from "@/domain/location-sharing";
import type { Role } from "@/domain/roles";
import type { ServiceLevel } from "@/domain/service-level";
import { isTerminalStatus, type ShipmentStatus } from "@/domain/shipment-status";
import type { AuthContext } from "@/server/auth/auth-context";
import { getAuth } from "@/server/auth/auth";
import { signUpWithOrganization } from "@/server/auth/sign-up";
import { getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";
import { changeShipmentStatus } from "@/server/services/change-shipment-status";
import { createShipment } from "@/server/services/create-shipment";
import { recordLocationPing } from "@/server/services/record-location-ping";

/**
 * Demo data for "Demo Freight Co": three accounts (one per role) and 30 shipments across every
 * status. Everything goes through the real code paths: users through Better Auth (hashed
 * passwords), shipments through `createShipment` and history through `changeShipmentStatus`, so
 * every timeline obeys the state machine, the role rules and the event-time ordering. The demo
 * driver's unfinished shipments get a last known position through `recordLocationPing`, so the
 * live map has something to show before any simulator runs.
 *
 * Re-running is a no-op once the demo admin exists: history cannot be deleted, so the seed never
 * tries to "refresh" rows. `pnpm db:seed --reset` wipes the local dev database first instead.
 */

export const DEMO_ORGANIZATION_NAME = "Demo Freight Co";
/** Demo-only credentials, published in the README. */
export const DEMO_PASSWORD = "demo-password";

export const DEMO_USERS = [
  { role: "admin", name: "Alex Admin", email: "admin@demo.test" },
  { role: "dispatcher", name: "Dana Dispatcher", email: "dispatcher@demo.test" },
  { role: "driver", name: "Dries Driver", email: "driver@demo.test" },
] as const satisfies readonly { role: Role; name: string; email: string }[];

export type SeedResult =
  | { status: "seeded"; organizationId: string; shipmentCount: number }
  | { status: "skipped"; reason: string };

type City = {
  city: string;
  country: string;
  postalCode: string;
  address: string;
  lat: number;
  lng: number;
};

const CITIES: readonly City[] = [
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

/** Small deterministic PRNG (mulberry32), so every seeded database looks the same. */
function createRandom(seed: number) {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    between: (min: number, max: number) => min + next() * (max - min),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (probability: number) => next() < probability,
  };
}

export async function seedDemo({ now = new Date() }: { now?: Date } = {}): Promise<SeedResult> {
  const admin = DEMO_USERS[0];
  const [existing] = await getDb()
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, admin.email));
  if (existing) return { status: "skipped", reason: `${admin.email} already exists` };

  const contexts = await createDemoAccounts();
  const random = createRandom(2026);

  for (const [index, plan] of PLANS.entries()) {
    await seedShipment(index, plan, contexts, random, now);
  }

  return {
    status: "seeded",
    organizationId: contexts.dispatcher.organizationId,
    shipmentCount: PLANS.length,
  };
}

async function createDemoAccounts(): Promise<Record<Role, AuthContext>> {
  const [admin, dispatcher, driver] = DEMO_USERS;
  const signUp = await signUpWithOrganization({
    name: admin.name,
    email: admin.email,
    password: DEMO_PASSWORD,
    organizationName: DEMO_ORGANIZATION_NAME,
  });
  if (!signUp.ok) throw new Error(`Could not create the demo admin: ${JSON.stringify(signUp)}`);
  const { organizationId } = signUp;

  const auth = getAuth();
  const member = async (account: (typeof DEMO_USERS)[number]): Promise<AuthContext> => {
    const { user: created } = await auth.api.signUpEmail({
      body: { name: account.name, email: account.email, password: DEMO_PASSWORD },
    });
    await auth.api.addMember({
      body: { userId: created.id, organizationId, role: account.role },
    });
    return { userId: created.id, organizationId, role: account.role };
  };

  return {
    admin: { userId: signUp.userId, organizationId, role: "admin" },
    dispatcher: await member(dispatcher),
    driver: await member(driver),
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

async function seedShipment(
  index: number,
  plan: readonly ShipmentStatus[],
  contexts: Record<Role, AuthContext>,
  random: ReturnType<typeof createRandom>,
  now: Date,
): Promise<void> {
  const origin = random.pick(CITIES);
  const destination = random.pick(CITIES.filter((city) => city !== origin));
  const serviceLevel = random.pick<ServiceLevel>(["standard", "standard", "express", "same_day"]);
  // Half of the shipments that leave the depot are driven by the demo driver.
  const assigned = plan[0] === "picked_up" && index % 2 === 0;

  // Event times: hours apart, oldest first, all in the past. Booked up to a few days ago.
  const gaps = plan.map(() => random.between(2, 14) * HOUR);
  const historyLength = gaps.reduce((sum, gap) => sum + gap, 0);
  const createdAt = roundToMinute(
    new Date(now.getTime() - historyLength - random.between(1, plan.length ? 30 : 72) * HOUR),
  );
  const promised = promisedDelivery({
    finished: isTerminalStatus(plan.at(-1) ?? "created"),
    overdue: OVERDUE_SHIPMENTS.has(index),
    serviceLevel,
    createdAt,
    now,
  });

  const created = await createShipment(
    contexts.dispatcher,
    {
      reference: random.chance(0.75) ? `PO-${48100 + index * 37}` : "",
      recipientName: random.pick(RECIPIENTS),
      recipientEmail: random.chance(0.5) ? `customer${index + 1}@example.com` : "",
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
      weightKg: Math.round(random.between(0.5, 1200) * 10) / 10,
      serviceLevel,
      promisedDeliveryAt: promised,
      assignedDriverId: assigned ? contexts.driver.userId : "",
    },
    { now: () => createdAt },
  );
  if (!created.ok) throw new Error(`Seed shipment ${index} rejected: ${JSON.stringify(created)}`);

  // Real-world times of each step, oldest first.
  const times: Date[] = [];
  for (const gap of gaps)
    times.push(roundToMinute(new Date((times.at(-1) ?? createdAt).getTime() + gap)));
  const lastPing = lastPingMoment(plan, times, { assigned, index, now });

  let version = created.shipment.version;
  for (const [step, toStatus] of plan.entries()) {
    const occurredAt = times[step]!;
    const place =
      toStatus === "out_for_delivery" || toStatus === "delivered" ? destination : origin;
    // Drivers record their own shipments' progress; cancelling is always the office's call.
    const actor = assigned && toStatus !== "cancelled" ? contexts.driver : contexts.dispatcher;

    const result = await changeShipmentStatus(actor, {
      shipmentId: created.shipment.id,
      expectedVersion: version,
      toStatus,
      occurredAt,
      publicNote: random.chance(0.8) ? random.pick(PUBLIC_NOTES[toStatus] ?? [""]) : "",
      internalNote: random.chance(0.3) ? random.pick(INTERNAL_NOTES) : "",
      location: { city: place.city, lat: place.lat, lng: place.lng },
    });
    if (!result.ok) {
      throw new Error(`Seed shipment ${index} -> ${toStatus} rejected: ${JSON.stringify(result)}`);
    }
    version = result.shipment.version;

    if (lastPing?.afterStep === step) {
      await seedPosition(contexts.driver, created.shipment.id, {
        origin,
        destination,
        status: toStatus,
        index,
        recordedAt: lastPing.at,
      });
    }
  }
}

/**
 * When the demo driver's phone last reported an unfinished shipment: a few minutes ago if it is
 * still on the road, or shortly before it ran into its exception (pings stop then, and the last
 * position is what dispatch looks at). Null for everything else.
 */
function lastPingMoment(
  plan: readonly ShipmentStatus[],
  times: readonly Date[],
  { assigned, index, now }: { assigned: boolean; index: number; now: Date },
): { afterStep: number; at: Date } | null {
  const last = plan.length - 1;
  if (!assigned || last < 0 || isTerminalStatus(plan[last]!)) return null;
  if (isLocationSharingStatus(plan[last]!)) {
    // Varied but deterministic (no draw from the PRNG, so the rest of the seed stays unchanged).
    return {
      afterStep: last,
      at: new Date(now.getTime() - (2 + ((index * 7) % 23)) * 60_000),
    };
  }
  if (plan[last] === "exception" && last > 0 && isLocationSharingStatus(plan[last - 1]!)) {
    return { afterStep: last - 1, at: new Date(times[last]!.getTime() - 20 * 60_000) };
  }
  return null;
}

/** How far along the straight line from pickup to delivery a shipment in `status` is drawn. */
function progressFor(status: ShipmentStatus, index: number): number {
  if (status === "picked_up") return 0.08;
  if (status === "out_for_delivery") return 0.9;
  return 0.3 + (index % 5) * 0.1;
}

async function seedPosition(
  driver: AuthContext,
  shipmentId: string,
  {
    origin,
    destination,
    status,
    index,
    recordedAt,
  }: { origin: City; destination: City; status: ShipmentStatus; index: number; recordedAt: Date },
): Promise<void> {
  const progress = progressFor(status, index);
  const result = await recordLocationPing(
    driver,
    {
      shipmentId,
      lat: round(origin.lat + (destination.lat - origin.lat) * progress),
      lng: round(origin.lng + (destination.lng - origin.lng) * progress),
      accuracyM: 12,
      recordedAt,
    },
    // Received a moment after the fix, as from a phone with a decent connection.
    { now: () => new Date(recordedAt.getTime() + 3_000) },
  );
  if (!result.ok || !result.accepted) {
    throw new Error(`Seed position for shipment ${index} rejected: ${JSON.stringify(result)}`);
  }
}

const round = (degrees: number) => Math.round(degrees * 1e5) / 1e5;

function roundToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000);
}
