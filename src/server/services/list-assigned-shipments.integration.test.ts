import { beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "@/server/auth/auth-context";

import {
  createTestContext,
  createTestOrganization,
  createTestShipment,
} from "../../../tests/integration/fixtures";
import { FINISHED_LIMIT, listAssignedShipments } from "./list-assigned-shipments";

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 60 * 60_000);

describe("listAssignedShipments", () => {
  let orgId: string;
  let dispatcher: AuthContext;
  let driver: AuthContext;

  beforeAll(async () => {
    orgId = (await createTestOrganization()).id;
    dispatcher = await createTestContext(orgId, "dispatcher");
    driver = await createTestContext(orgId, "driver");
  });

  const assigned = (overrides: Parameters<typeof createTestShipment>[2] = {}) =>
    createTestShipment(orgId, dispatcher.userId, { assignedDriverId: driver.userId, ...overrides });

  it("lists active shipments by promised delivery, finished ones separately", async () => {
    const later = await assigned({ status: "in_transit", promisedDeliveryAt: hoursFromNow(8) });
    const noDeadline = await assigned({ status: "created" });
    const soon = await assigned({ status: "picked_up", promisedDeliveryAt: hoursFromNow(2) });
    const delivered = await assigned({ status: "delivered" });
    // Not this driver's: unassigned, another driver's, and another organization's.
    await createTestShipment(orgId, dispatcher.userId);
    const colleague = await createTestContext(orgId, "driver");
    await createTestShipment(orgId, dispatcher.userId, { assignedDriverId: colleague.userId });
    const otherOrg = (await createTestOrganization()).id;
    const otherDispatcher = await createTestContext(otherOrg, "dispatcher");
    await createTestShipment(otherOrg, otherDispatcher.userId, {
      assignedDriverId: driver.userId,
    });

    const result = await listAssignedShipments(driver);

    expect(result.active.map((row) => row.id)).toEqual([soon.id, later.id, noDeadline.id]);
    expect(result.finished.map((row) => row.id)).toEqual([delivered.id]);
  });

  it("returns only the fields a driver needs", async () => {
    const result = await listAssignedShipments(driver);

    expect(Object.keys(result.active[0]!).sort()).toEqual([
      "destinationAddressLine",
      "destinationCity",
      "destinationCountry",
      "id",
      "originAddressLine",
      "originCity",
      "originCountry",
      "promisedDeliveryAt",
      "recipientName",
      "serviceLevel",
      "status",
      "trackingCode",
      "updatedAt",
    ]);
  });

  it("keeps a dispatcher's list personal instead of showing the whole organization", async () => {
    expect(await listAssignedShipments(dispatcher)).toEqual({ active: [], finished: [] });
  });

  it(`shows at most ${FINISHED_LIMIT} finished shipments, most recent first`, async () => {
    const busy = await createTestContext(orgId, "driver");
    const finished = [];
    for (let i = 0; i < FINISHED_LIMIT + 2; i++) {
      finished.push(
        await createTestShipment(orgId, dispatcher.userId, {
          assignedDriverId: busy.userId,
          status: i % 2 ? "delivered" : "cancelled",
          updatedAt: hoursFromNow(-i),
        }),
      );
    }

    const result = await listAssignedShipments(busy);

    expect(result.finished.map((row) => row.id)).toEqual(
      finished.slice(0, FINISHED_LIMIT).map((row) => row.id),
    );
  });
});
