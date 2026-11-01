import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { canSetStatus } from "@/domain/shipment-permissions";
import { canTransition } from "@/domain/shipment-status";
import { createRandom } from "@/lib/random";
import { distanceAlong, measureRoute } from "@/lib/route-geometry";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { locationPings } from "@/server/db/schema";
import { routeBetween } from "@/server/routes/road-routes";
import { CITIES, type City } from "@/server/seed/demo-data";
import { changeShipmentStatus } from "@/server/services/change-shipment-status";
import { createShipment } from "@/server/services/create-shipment";
import { getShipment } from "@/server/services/get-shipment";
import { getShipmentPositions } from "@/server/services/get-shipment-positions";
import { listAssignedShipments } from "@/server/services/list-assigned-shipments";
import { listShipments } from "@/server/services/list-shipments";
import { recordLocationPing } from "@/server/services/record-location-ping";
import { createTestContext, createTestOrganization } from "../../../tests/integration/fixtures";
import { recordRealtime } from "../../../tests/integration/realtime";

import { createSimulator, type TickReport } from "./simulator";
import type { SimulatorConfig } from "./truck";

const city = (name: string) => CITIES.find((candidate) => candidate.city === name)!;
const BRUSSELS = city("Brussels");
const ANTWERP = city("Antwerp");
const GHENT = city("Ghent");

/**
 * Fast enough that a 45 km route is driven in a handful of ticks: 80 km/h for 12 s at 100x is
 * about 27 km per tick. No random exceptions unless a test asks for them.
 */
const FAST: Partial<SimulatorConfig> = { timeCompression: 100, exceptionChance: 0 };

/**
 * A stepping clock starting now. The simulator passes it to the services as `deps.now`, so their
 * future-time checks follow it instead of the real clock.
 */
function steppingClock(stepMs = 12_000) {
  let time = Date.now();
  return {
    now: () => new Date(time),
    step: (ms = stepMs) => {
      time += ms;
    },
  };
}

let realtime: Awaited<ReturnType<typeof recordRealtime>>;
beforeAll(async () => {
  realtime = await recordRealtime();
});
afterAll(() => realtime.unsubscribe());

async function setUp() {
  const org = await createTestOrganization("Simulated Freight");
  const dispatcher = await createTestContext(org.id, "dispatcher");
  const driver = await createTestContext(org.id, "driver");
  return { org, dispatcher, driver };
}

/** Books a shipment between two seed cities, assigned to `driver`, two hours ago. */
async function book(
  dispatcher: AuthContext,
  driver: AuthContext | null,
  from: City,
  to: City,
  { withCoordinates = true } = {},
) {
  const result = await createShipment(
    dispatcher,
    {
      recipientName: "Sim Recipient",
      originAddressLine: from.address,
      originCity: from.city,
      originCountry: from.country,
      originLat: withCoordinates ? from.lat : "",
      originLng: withCoordinates ? from.lng : "",
      destinationAddressLine: to.address,
      destinationCity: to.city,
      destinationCountry: to.country,
      destinationLat: withCoordinates ? to.lat : "",
      destinationLng: withCoordinates ? to.lng : "",
      weightKg: 20,
      assignedDriverId: driver?.userId ?? "",
    },
    { now: () => new Date(Date.now() - 2 * 60 * 60_000) },
  );
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.shipment;
}

/** Moves a shipment through `statuses` as `actor`, by default 90 minutes ago. */
async function advance(
  actor: AuthContext,
  shipmentId: string,
  statuses: string[],
  at = new Date(Date.now() - 90 * 60_000),
) {
  for (const toStatus of statuses) {
    const current = await getShipment(actor, shipmentId);
    if (!current.ok) throw new Error("not found");
    const result = await changeShipmentStatus(actor, {
      shipmentId,
      expectedVersion: current.shipment.version,
      toStatus,
      occurredAt: at,
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
  }
}

async function pingCount(shipmentId: string): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(locationPings)
    .where(and(eq(locationPings.shipmentId, shipmentId)));
  return row!.value;
}

async function runTicks(
  simulator: ReturnType<typeof createSimulator>,
  clock: ReturnType<typeof steppingClock>,
  ticks: number,
): Promise<TickReport[]> {
  const reports: TickReport[] = [];
  for (let i = 0; i < ticks; i++) {
    reports.push(await simulator.tick());
    clock.step();
  }
  return reports;
}

describe("the truck simulator", () => {
  it("picks up, drives and delivers an assigned shipment through the services", async () => {
    const { dispatcher, driver } = await setUp();
    const shipment = await book(dispatcher, driver, BRUSSELS, ANTWERP);
    const clock = steppingClock();
    const simulator = createSimulator({
      drivers: [driver],
      random: createRandom(1),
      config: FAST,
      clock: clock.now,
    });

    const positions: { lat: number; lng: number }[] = [];
    const reports: TickReport[] = [];
    for (let tick = 0; tick < 6; tick++) {
      reports.push(await simulator.tick());
      clock.step();
      const snapshot = await getShipmentPositions(dispatcher, { shipmentIds: [shipment.id] });
      if (snapshot.ok && snapshot.positions[0]) positions.push(snapshot.positions[0]);
    }

    // Every action was accepted: no refused transition, conflict or throttled ping.
    const outcomes = reports.flatMap((report) => report.events.map((event) => event.outcome));
    expect(new Set(outcomes)).toEqual(new Set(["ok"]));

    // The history follows the state machine, recorded by the driver, ending with the delivery.
    const detail = await getShipment(dispatcher, shipment.id);
    if (!detail.ok) throw new Error("not found");
    const statusEvents = detail.events.filter((event) => event.toStatus !== null);
    expect(statusEvents.map((event) => event.toStatus)).toEqual([
      "created",
      "picked_up",
      "in_transit",
      "out_for_delivery",
      "delivered",
    ]);
    for (const event of statusEvents.slice(1)) {
      expect(canTransition(event.fromStatus!, event.toStatus!)).toBe(true);
      expect(event.actorUserId).toBe(driver.userId);
    }
    expect(statusEvents.at(-1)).toMatchObject({
      publicNote: "Delivered to reception",
      locationCity: "Antwerp",
    });
    expect(statusEvents[1]).toMatchObject({ locationCity: "Brussels" });

    // The truck moved along its road route, from the pickup to the delivery address.
    const route = measureRoute(routeBetween(BRUSSELS, ANTWERP).line);
    const along = positions.map((position) => distanceAlong(route, position));
    for (let i = 1; i < along.length; i++) expect(along[i]!).toBeGreaterThanOrEqual(along[i - 1]!);
    expect(along[0]).toBeCloseTo(0, 0);
    expect(along.at(-1)).toBeCloseTo(route.lengthM, 0);
    expect(await pingCount(shipment.id)).toBe(4);

    // The dispatcher's screens heard about it: positions and status changes on the bus.
    await realtime.flush();
    const messages = realtime.about(shipment.id);
    expect(messages.filter((m) => m.kind === "position")).toHaveLength(4);
    expect(
      messages.filter((m) => m.kind === "shipment_changed" && m.reason === "status"),
    ).toHaveLength(4);

    // Nothing left to drive: the script's cue to suggest a reseed.
    expect(reports.at(-1)!.remaining).toBe(0);
  });

  it("carries on from the last known position, projected onto the road", async () => {
    const { dispatcher, driver } = await setUp();
    const shipment = await book(dispatcher, driver, GHENT, BRUSSELS);
    await advance(driver, shipment.id, ["picked_up", "in_transit"]);
    const route = measureRoute(routeBetween(GHENT, BRUSSELS).line);
    // Last seen 20 km along, a little off the road.
    const clock = steppingClock();
    await recordLocationPing(
      driver,
      { shipmentId: shipment.id, lat: 50.98, lng: 3.95, accuracyM: 30, recordedAt: clock.now() },
      { now: clock.now },
    );
    const start = distanceAlong(route, { lat: 50.98, lng: 3.95 });
    clock.step();

    const simulator = createSimulator({
      drivers: [driver],
      random: createRandom(1),
      config: { ...FAST, timeCompression: 10 },
      clock: clock.now,
    });
    const [report] = await runTicks(simulator, clock, 1);

    expect(report!.events).toEqual([
      expect.objectContaining({
        action: { kind: "ping", distanceM: expect.any(Number) },
        outcome: "ok",
      }),
    ]);
    const { distanceM } = report!.events[0]!.action as { distanceM: number };
    // 80 km/h for 12 s at 10x is about 2.7 km further on.
    expect(distanceM - start).toBeCloseTo((80 / 3.6) * 12 * 10, 0);
  });

  it("treats a throttled ping as a normal outcome and keeps the truck moving", async () => {
    const { dispatcher, driver } = await setUp();
    const shipment = await book(dispatcher, driver, BRUSSELS, ANTWERP);
    await advance(driver, shipment.id, ["picked_up", "in_transit"]);
    const clock = steppingClock(4_000); // Faster than the 10 s server throttle.
    const simulator = createSimulator({
      drivers: [driver],
      random: createRandom(1),
      config: { ...FAST, timeCompression: 5 },
      clock: clock.now,
    });

    const reports = await runTicks(simulator, clock, 3);
    const pings = reports.flatMap((report) => report.events);
    expect(pings.map((event) => event.outcome)).toEqual(["ok", "throttled", "throttled"]);
    const distances = pings.map((event) => (event.action as { distanceM: number }).distanceM);
    expect(distances[2]).toBeGreaterThan(distances[1]!);
    expect(await pingCount(shipment.id)).toBe(1);

    // The next tick outside the window reports the position the truck has reached by then.
    clock.step(10_000);
    const [next] = await runTicks(simulator, clock, 1);
    expect(next!.events[0]!.outcome).toBe("ok");
    expect(await pingCount(shipment.id)).toBe(2);
  });

  it("raises an occasional exception with a public note, then carries on", async () => {
    const { dispatcher, driver } = await setUp();
    const shipment = await book(dispatcher, driver, BRUSSELS, ANTWERP);
    await advance(driver, shipment.id, ["picked_up", "in_transit"]);
    const clock = steppingClock();
    const simulator = createSimulator({
      drivers: [driver],
      random: createRandom(1),
      config: { ...FAST, timeCompression: 5, exceptionChance: 1, exceptionTicks: 2 },
      clock: clock.now,
    });

    const reports = await runTicks(simulator, clock, 4);
    expect(reports.map((report) => report.events.map((event) => event.action.kind))).toEqual([
      ["status"],
      ["idle"],
      ["status", "ping"],
      ["ping"], // At most one exception per truck, even at chance 1.
    ]);

    const detail = await getShipment(dispatcher, shipment.id);
    if (!detail.ok) throw new Error("not found");
    const exception = detail.events.find((event) => event.toStatus === "exception")!;
    expect(exception.publicNote).toMatch(/\w/);
    expect(exception.actorUserId).toBe(driver.userId);
    expect(detail.shipment.status).toBe("in_transit");
  });

  it("clears an exception the driver recorded earlier, e.g. before a restart", async () => {
    const { dispatcher, driver } = await setUp();
    const shipment = await book(dispatcher, driver, GHENT, BRUSSELS);
    await advance(driver, shipment.id, ["picked_up", "in_transit", "exception"]);
    const clock = steppingClock();
    const simulator = createSimulator({
      drivers: [driver],
      random: createRandom(1),
      config: { ...FAST, timeCompression: 5, exceptionChance: 1, exceptionTicks: 2 },
      clock: clock.now,
    });

    const reports = await runTicks(simulator, clock, 3);
    expect(reports.map((report) => report.events.map((event) => event.action.kind))).toEqual([
      ["idle"],
      ["status", "ping"],
      ["ping"], // It already had its exception: no second one, even at chance 1.
    ]);
    const detail = await getShipment(dispatcher, shipment.id);
    expect(detail.ok && detail.shipment.status).toBe("in_transit");
  });

  it("drives only its drivers' own shipments, and leaves the office's business alone", async () => {
    const { dispatcher, driver } = await setUp();
    const otherDriver = await createTestContext(dispatcher.organizationId, "driver");
    const someoneElses = await book(dispatcher, otherDriver, BRUSSELS, ANTWERP);
    const unassigned = await book(dispatcher, null, BRUSSELS, ANTWERP);
    const noCoordinates = await book(dispatcher, driver, BRUSSELS, ANTWERP, {
      withCoordinates: false,
    });
    const officeException = await book(dispatcher, driver, GHENT, BRUSSELS);
    await advance(driver, officeException.id, ["picked_up"]);
    await advance(dispatcher, officeException.id, ["exception"]);
    const other = await setUp();
    const otherOrg = await book(other.dispatcher, other.driver, BRUSSELS, ANTWERP);

    const lines: string[] = [];
    const clock = steppingClock();
    const simulator = createSimulator({
      drivers: [driver],
      random: createRandom(1),
      config: FAST,
      clock: clock.now,
      log: (line) => lines.push(line),
    });
    const reports = await runTicks(simulator, clock, 2);

    expect(reports.every((report) => report.events.length === 0)).toBe(true);
    for (const untouched of [someoneElses, unassigned, noCoordinates, officeException, otherOrg]) {
      const actor = untouched === otherOrg ? other.dispatcher : dispatcher;
      const detail = await getShipment(actor, untouched.id);
      if (!detail.ok) throw new Error("not found");
      expect(detail.shipment.version).toBe(untouched === officeException ? 3 : 1);
    }
    // Each skip is explained once, not every tick.
    expect(lines.filter((line) => line.includes("no pickup/delivery coordinates"))).toHaveLength(1);
    expect(lines.filter((line) => line.includes("exception left for the office"))).toHaveLength(1);
  });

  it("drives at most the requested number of trucks, and follows the office's changes", async () => {
    const { dispatcher, driver } = await setUp();
    await book(dispatcher, driver, BRUSSELS, ANTWERP);
    await book(dispatcher, driver, GHENT, BRUSSELS);
    const clock = steppingClock();
    const limited = createSimulator({
      drivers: [driver],
      random: createRandom(1),
      config: FAST,
      maxShipments: 1,
      clock: clock.now,
    });
    const [first] = await runTicks(limited, clock, 1);
    expect(first!.driven).toBe(1);
    expect(first!.remaining).toBe(2);

    // A dispatcher puts the driven shipment on hold between ticks: the simulator's next plan
    // (in transit) is no longer valid, and it follows the office's call instead of fighting it.
    const drivenId = first!.events[0]!.shipmentId;
    await advance(dispatcher, drivenId, ["exception"], clock.now());
    const [second] = await runTicks(limited, clock, 1);
    expect(second!.events.every((event) => event.shipmentId !== drivenId)).toBe(true);
    const held = await getShipment(dispatcher, drivenId);
    expect(held.ok && held.shipment.status).toBe("exception");
    for (const event of second!.events) {
      if (event.action.kind === "status") {
        expect(canSetStatus("driver", event.action.toStatus)).toBe(true);
      }
    }
  });
});

describe("the simulator's refill", () => {
  /** An organization with one dispatcher, one driver and a single shipment in the fleet. */
  async function fleetOfOne() {
    const { dispatcher, driver } = await setUp();
    const first = await book(dispatcher, driver, BRUSSELS, ANTWERP);
    return { dispatcher, driver, first };
  }

  async function unfinishedOf(ctx: AuthContext) {
    const { active } = await listAssignedShipments(ctx);
    return active;
  }

  it("books new work through the services once the fleet is delivered, and drives it", async () => {
    const { dispatcher, driver, first } = await fleetOfOne();
    const clock = steppingClock();
    const simulator = createSimulator({
      drivers: [driver],
      random: createRandom(5),
      config: FAST,
      clock: clock.now,
      refill: { dispatcher, target: 2, maxPerTick: 2 },
    });

    const reports = await runTicks(simulator, clock, 40);

    // The original truck was delivered, and the fleet was refilled for the rest of the run.
    const firstDetail = await getShipment(dispatcher, first.id);
    if (!firstDetail.ok) throw new Error("not found");
    expect(firstDetail.shipment.status).toBe("delivered");
    const booked = reports.flatMap((report) => report.booked);
    expect(booked.length).toBeGreaterThan(2);
    // Never above the target: it books only the gap.
    for (const report of reports) expect(report.remaining).toBeLessThanOrEqual(2);

    const delivered = await listShipments(dispatcher, { pageSize: 100 });
    if (!delivered.ok) throw new Error("list failed");
    const mine = delivered.rows.filter((item) => booked.includes(item.trackingCode));
    expect(mine).toHaveLength(booked.length);

    for (const item of mine) {
      expect(item.assignedDriverId).toBe(driver.userId);
    }
    const progressed = mine.filter((item) => item.status !== "created");
    expect(progressed.length).toBeGreaterThan(0);
    expect(mine.some((item) => item.status === "delivered")).toBe(true);

    const sample = mine.find((item) => item.status === "delivered")!;

    // The history shows the real path: booked and assigned by the dispatcher (the assignment is
    // stamped with the real clock, which is ahead of the test's), then the driver's changes.
    const detail = await getShipment(dispatcher, sample.id);
    if (!detail.ok) throw new Error("not found");
    for (const type of ["created", "driver_assigned"]) {
      const events = detail.events.filter((event) => event.type === type);
      expect(events).toHaveLength(1);
      expect(events[0]!.actorUserId).toBe(dispatcher.userId);
    }
    expect(detail.events.filter((event) => event.toStatus !== null).map((e) => e.toStatus)).toEqual(
      ["created", "picked_up", "in_transit", "out_for_delivery", "delivered"],
    );
    // Booking, assignment and four status changes: each bumped the version.
    expect(detail.shipment.version).toBe(6);
    expect(detail.shipment.promisedDeliveryAt).not.toBeNull();
    expect(await unfinishedOf(driver)).toBeDefined();

    // Bookings were announced like any other: created, then the assignment.
    await realtime.flush();
    const messages = realtime.about(sample.id);
    expect(messages.filter((m) => m.kind === "shipment_changed").length).toBeGreaterThanOrEqual(3);
  });

  it("books at most maxPerTick per tick, and only the gap", async () => {
    const { dispatcher, driver } = await setUp();
    const clock = steppingClock();
    const simulator = createSimulator({
      drivers: [driver],
      random: createRandom(9),
      config: { ...FAST, timeCompression: 1 },
      clock: clock.now,
      refill: { dispatcher, target: 5, maxPerTick: 2 },
    });

    const reports = await runTicks(simulator, clock, 4);
    // An empty fleet and a target of 5: 2, 2, 1, then nothing (slow trucks, none delivered yet).
    expect(reports.map((report) => report.booked.length)).toEqual([2, 2, 1, 0]);
    expect((await unfinishedOf(driver)).length).toBe(5);
  });

  it("books nothing when the fleet is at target, or without a refill option", async () => {
    const { dispatcher, driver, first } = await fleetOfOne();
    const clock = steppingClock();
    const atTarget = createSimulator({
      drivers: [driver],
      random: createRandom(1),
      config: { ...FAST, timeCompression: 1 },
      clock: clock.now,
      refill: { dispatcher, target: 1 },
    });
    expect((await atTarget.tick()).booked).toEqual([]);

    const disabled = createSimulator({
      drivers: [driver],
      random: createRandom(1),
      config: FAST,
      clock: clock.now,
    });
    const reports = await runTicks(disabled, clock, 10);
    expect(reports.flatMap((report) => report.booked)).toEqual([]);
    expect((await unfinishedOf(driver)).filter((s) => s.id !== first.id)).toEqual([]);
  });

  it("stops refilling when the office account is refused", async () => {
    const { driver } = await setUp();
    const clock = steppingClock();
    const lines: string[] = [];
    const simulator = createSimulator({
      drivers: [driver],
      random: createRandom(1),
      clock: clock.now,
      log: (line) => lines.push(line),
      // A driver may not book shipments: the service says forbidden.
      refill: { dispatcher: driver, target: 3 },
    });
    expect((await simulator.tick()).booked).toEqual([]);
    expect(lines.some((line) => line.includes("booking refused: forbidden"))).toBe(true);
  });
});
