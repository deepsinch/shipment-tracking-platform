import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/server/db/client";
import { organization, shipments, user } from "@/server/db/schema";
import { seedDemo } from "@/server/seed/demo-seed";

import { createTestOrganization } from "../../../../../tests/integration/fixtures";
import { useDedicatedDatabase } from "../../../../../tests/integration/dedicated-database";

/**
 * The nightly reset, against a dedicated database (never the dev one, nor the main test database
 * the other files share). What it wipes is proven by a marker organization that must not survive.
 * Demo mode and the allow-list are read from the environment when the route is imported, so each
 * test loads a fresh copy of the route with the settings it wants.
 */

const SECRET = "a-long-enough-cron-secret";
let databaseName: string;
beforeAll(async () => {
  databaseName = new URL(await useDedicatedDatabase("demo")).pathname.slice(1);
}, 60_000);

afterEach(() => vi.unstubAllEnvs());

async function loadGet({ demoMode = true, allowed = databaseName } = {}) {
  vi.resetModules();
  vi.stubEnv("DEMO_MODE", String(demoMode));
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("DEMO_RESET_DATABASES", allowed);
  return (await import("./route")).GET;
}

const request = (authorization?: string) =>
  new Request("http://localhost/api/cron/reset-demo", {
    headers: authorization === undefined ? {} : { authorization },
  });

async function markerExists(id: string) {
  return (await getDb().select().from(organization).where(eq(organization.id, id))).length === 1;
}

describe("GET /api/cron/reset-demo", () => {
  it("answers 404 when demo mode is off, even with the right secret, and wipes nothing", async () => {
    const marker = await createTestOrganization("Survivor");
    const get = await loadGet({ demoMode: false });

    const response = await get(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(404);
    expect(await markerExists(marker.id)).toBe(true);
  });

  it.each([
    ["no Authorization header", undefined],
    ["a wrong secret", "Bearer not-the-secret-at-all"],
    ["the secret without the Bearer scheme", SECRET],
    ["an empty header", ""],
    ["the secret with extra characters", `Bearer ${SECRET}x`],
  ])("answers 401 with %s, and wipes nothing", async (_name, authorization) => {
    const marker = await createTestOrganization("Survivor");
    const get = await loadGet();

    const response = await get(request(authorization));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(await markerExists(marker.id)).toBe(true);
  });

  it("refuses a database that is not in DEMO_RESET_DATABASES, wiping nothing", async () => {
    const marker = await createTestOrganization("Survivor");
    const get = await loadGet({ allowed: "some_other_database" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await get(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(500);
    // Nothing about the database leaves the server; the logs name it.
    expect(await response.text()).not.toContain(databaseName);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(databaseName));
    expect(await markerExists(marker.id)).toBe(true);
    log.mockRestore();
  });

  it("wipes, migrates and re-seeds the database for the right secret", async () => {
    const marker = await createTestOrganization("Survivor");
    const get = await loadGet();

    const response = await get(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "reset", shipmentCount: 30 });
    expect(await markerExists(marker.id)).toBe(false);
    expect(await getDb().select().from(user).where(eq(user.email, "admin@demo.test"))).toHaveLength(
      1,
    );
    expect(await getDb().select().from(shipments)).toHaveLength(30);
    // The demo is intact: seeding again is the no-op it always was.
    expect(await seedDemo()).toMatchObject({ status: "skipped" });
  }, 120_000);
});
