import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { user } from "@/server/db/schema";

import {
  createTestContext,
  createTestOrganization,
  createTestUser,
} from "../../../tests/integration/fixtures";
import { listDrivers } from "./list-drivers";

describe("listDrivers", () => {
  let orgId: string;
  let dispatcher: AuthContext;
  let driverIds: string[];

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
    await createTestContext(orgId, "admin");
    const zoe = await createTestUser(orgId, "driver");
    const ann = await createTestUser(orgId, "driver");
    await getDb().update(user).set({ name: "Zoe Driver" }).where(eq(user.id, zoe.id));
    await getDb().update(user).set({ name: "Ann Driver" }).where(eq(user.id, ann.id));
    driverIds = [ann.id, zoe.id];

    // A driver in another organization must never be listed.
    await createTestUser((await createTestOrganization()).id, "driver");
  });

  it("lists only the organization's drivers, sorted by name", async () => {
    const result = await listDrivers(dispatcher);

    if (!result.ok) throw new Error("expected drivers");
    expect(result.drivers.map((driver) => driver.id)).toEqual(driverIds);
    expect(result.drivers.map((driver) => driver.name)).toEqual(["Ann Driver", "Zoe Driver"]);
    expect(Object.keys(result.drivers[0]!).sort()).toEqual(["email", "id", "name"]);
  });

  it("is available to admins", async () => {
    const admin = await createTestContext(orgId, "admin");

    const result = await listDrivers(admin);

    expect(result.ok && result.drivers.map((driver) => driver.id)).toEqual(driverIds);
  });

  it("is forbidden for drivers", async () => {
    // In its own organization, so it does not change the driver list the other tests expect.
    const driver = await createTestContext((await createTestOrganization()).id, "driver");

    expect(await listDrivers(driver)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("returns an empty list for an organization without drivers", async () => {
    const lonely = await createTestContext((await createTestOrganization()).id, "admin");

    expect(await listDrivers(lonely)).toEqual({ ok: true, drivers: [] });
  });
});
