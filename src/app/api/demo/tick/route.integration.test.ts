import { count } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/server/db/client";
import { demoTickState, locationPings } from "@/server/db/schema";
import { seedDemo } from "@/server/seed/demo-seed";

import {
  sessionHeaders,
  signedInStranger,
  useDedicatedDatabase,
} from "../../../../../tests/integration/dedicated-database";

/**
 * The tick endpoint, invoked with constructed requests carrying real session cookies, against a
 * dedicated database that holds the seeded demo. Demo mode is read from the environment when the
 * route is imported, so each test loads a fresh copy of the route with the mode it wants.
 */

let databaseName: string;
beforeAll(async () => {
  databaseName = new URL(await useDedicatedDatabase("demo")).pathname.slice(1);
  await seedDemo(); // a no-op when an earlier run (or the reset test) already did
}, 120_000);

afterEach(() => vi.unstubAllEnvs());

async function loadTick(demoMode: boolean) {
  vi.resetModules();
  vi.stubEnv("DEMO_MODE", String(demoMode));
  vi.stubEnv("CRON_SECRET", "a-long-enough-cron-secret");
  vi.stubEnv("DEMO_RESET_DATABASES", databaseName);
  return (await import("./route")).POST;
}

const tickRequest = (headers?: Headers) =>
  new Request("http://localhost/api/demo/tick", { method: "POST", headers });

const resetThrottle = () => getDb().delete(demoTickState);
const pingCount = async () => (await getDb().select({ n: count() }).from(locationPings))[0]!.n;

describe("POST /api/demo/tick", () => {
  it("answers 404 when demo mode is off, whoever asks and whatever it would have done", async () => {
    await resetThrottle();
    const tick = await loadTick(false);
    const pingsBefore = await pingCount();

    const anonymous = await tick(tickRequest());
    const member = await tick(
      tickRequest(await sessionHeaders("dispatcher@demo.test", "demo-password")),
    );

    expect(anonymous.status).toBe(404);
    expect(member.status).toBe(404);
    expect(await pingCount()).toBe(pingsBefore);
    // The throttle was not even touched.
    expect(await getDb().select().from(demoTickState)).toEqual([]);
  });

  it("answers 401 without a session", async () => {
    const tick = await loadTick(true);

    const response = await tick(tickRequest());

    expect(response.status).toBe(401);
  });

  it("answers 403 to a member of another organization, even one called Demo Freight Co", async () => {
    await resetThrottle();
    const tick = await loadTick(true);

    const response = await tick(tickRequest(await signedInStranger()));

    expect(response.status).toBe(403);
    expect(await getDb().select().from(demoTickState)).toEqual([]);
  });

  it("drives the demo trucks one tick for a member of the demo organization, then throttles", async () => {
    await resetThrottle();
    const tick = await loadTick(true);
    const headers = await sessionHeaders("dispatcher@demo.test", "demo-password");
    const pingsBefore = await pingCount();

    const first = await tick(tickRequest(headers));
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body).toMatchObject({ ran: true });
    expect(body.driven).toBeGreaterThan(0);
    // The simulator acted as the drivers, through recordLocationPing.
    expect(await pingCount()).toBeGreaterThan(pingsBefore);

    const second = await tick(tickRequest(headers));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ran: false, reason: "throttled" });
  }, 60_000);
});
