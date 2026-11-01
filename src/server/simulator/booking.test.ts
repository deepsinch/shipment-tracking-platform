import { describe, expect, it } from "vitest";

import { createRandom } from "@/lib/random";
import { roadRoutes } from "@/server/routes/road-routes";
import { CITIES } from "@/server/seed/demo-data";

import { bookablePairs, draftBooking, MAX_BOOKED_ROUTE_M, planRefill } from "./booking";

describe("planRefill", () => {
  const config = { target: 6, maxPerTick: 2 };

  it.each([
    { unfinished: 12, expected: 0, why: "a full fleet" },
    { unfinished: 6, expected: 0, why: "exactly at target" },
    { unfinished: 5, expected: 1, why: "one short" },
    { unfinished: 4, expected: 2, why: "two short" },
    { unfinished: 0, expected: 2, why: "an empty fleet is refilled gradually (capped per tick)" },
    { unfinished: -1, expected: 2, why: "a nonsensical count still obeys the cap" },
  ])("books $expected for $why", ({ unfinished, expected }) => {
    expect(planRefill(unfinished, config)).toBe(expected);
  });

  it("books nothing when refilling is capped at zero or the target is zero", () => {
    expect(planRefill(0, { target: 6, maxPerTick: 0 })).toBe(0);
    expect(planRefill(0, { target: 0, maxPerTick: 2 })).toBe(0);
  });

  it("books the whole gap when the cap allows it", () => {
    expect(planRefill(1, { target: 6, maxPerTick: 10 })).toBe(5);
  });
});

describe("bookablePairs", () => {
  it("uses only fixture routes with known cities, within the length cap", () => {
    const pairs = bookablePairs(roadRoutes());
    expect(pairs.length).toBeGreaterThan(10);
    for (const pair of pairs) {
      expect(pair.distanceM).toBeLessThanOrEqual(MAX_BOOKED_ROUTE_M);
      expect(CITIES).toContain(pair.origin);
      expect(CITIES).toContain(pair.destination);
    }
  });

  it("skips routes through a city it has no address for", () => {
    const [first] = roadRoutes();
    expect(bookablePairs([first!], [])).toEqual([]);
  });
});

describe("draftBooking", () => {
  const pairs = bookablePairs(roadRoutes());
  const now = new Date("2026-06-10T09:30:00Z");

  it("is deterministic for a seed", () => {
    const draw = (seed: number) => {
      const random = createRandom(seed);
      return Array.from({ length: 5 }, () => draftBooking(random, now, pairs));
    };
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
  });

  it("books realistic shipments on a committed road route", () => {
    const random = createRandom(3);
    for (let i = 0; i < 200; i++) {
      const booking = draftBooking(random, now, pairs);
      expect(
        pairs.some((p) => p.origin === booking.origin && p.destination === booking.destination),
      ).toBe(true);
      expect(booking.recipientName).not.toBe("");
      expect(booking.weightKg).toBeGreaterThan(0);
      expect(booking.weightKg).toBeLessThanOrEqual(1200);
      expect(booking.reference === "" || /^PO-\d{5}$/.test(booking.reference)).toBe(true);
      // Never born late: promised at 17:00 UTC, at least two hours out.
      expect(booking.promisedDeliveryAt.getTime()).toBeGreaterThanOrEqual(
        now.getTime() + 2 * 3600_000,
      );
      expect(booking.promisedDeliveryAt.getUTCHours()).toBe(17);
    }
  });

  it("rolls a same-day promise to tomorrow when 17:00 is under two hours away", () => {
    const random = createRandom(1);
    const late = new Date("2026-06-10T16:00:00Z");
    for (let i = 0; i < 50; i++) {
      const { promisedDeliveryAt } = draftBooking(random, late, pairs);
      expect(promisedDeliveryAt.getTime()).toBeGreaterThanOrEqual(late.getTime() + 2 * 3600_000);
    }
  });
});
