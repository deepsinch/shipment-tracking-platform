import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createTestOrganization,
  createTestShipment,
  createTestUser,
  pgErrorCode,
} from "../../../tests/integration/fixtures";
import { getDb } from "./client";
import { shipmentEvents, type Shipment } from "./schema";

const RESTRICT_VIOLATION = "23001";

/** Runs `fn` and returns the Postgres error code it failed with (or throws if it succeeded). */
async function failureCode(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (error) {
    return pgErrorCode(error);
  }
  throw new Error("Expected the statement to be rejected, but it succeeded");
}

describe("shipment_events is append-only", () => {
  let shipment: Shipment;
  let actorId: string;

  beforeAll(async () => {
    const org = await createTestOrganization();
    const actor = await createTestUser(org.id);
    actorId = actor.id;
    shipment = await createTestShipment(org.id, actor.id);
  });

  const eventsFor = (shipmentId: string) =>
    getDb().select().from(shipmentEvents).where(eq(shipmentEvents.shipmentId, shipmentId));

  it("allows INSERT", async () => {
    await getDb().insert(shipmentEvents).values({
      organizationId: shipment.organizationId,
      shipmentId: shipment.id,
      type: "status_changed",
      fromStatus: "created",
      toStatus: "picked_up",
      occurredAt: new Date(),
      actorUserId: actorId,
      publicNote: "Collected from sender",
    });

    const events = await eventsFor(shipment.id);
    expect(events.map((e) => e.toStatus)).toEqual(expect.arrayContaining(["created", "picked_up"]));
  });

  it("rejects UPDATE and leaves the row unchanged", async () => {
    const code = await failureCode(() =>
      getDb()
        .update(shipmentEvents)
        .set({ publicNote: "rewritten history" })
        .where(eq(shipmentEvents.shipmentId, shipment.id)),
    );
    expect(code).toBe(RESTRICT_VIOLATION);

    const events = await eventsFor(shipment.id);
    expect(events.some((e) => e.publicNote === "rewritten history")).toBe(false);
  });

  it("rejects DELETE and keeps the rows", async () => {
    const before = await eventsFor(shipment.id);

    const code = await failureCode(() =>
      getDb().delete(shipmentEvents).where(eq(shipmentEvents.shipmentId, shipment.id)),
    );
    expect(code).toBe(RESTRICT_VIOLATION);

    expect(await eventsFor(shipment.id)).toHaveLength(before.length);
  });

  it("rejects TRUNCATE, which bypasses row-level triggers", async () => {
    const code = await failureCode(() => getDb().execute(sql`TRUNCATE shipment_events`));
    expect(code).toBe(RESTRICT_VIOLATION);
  });

  it("explains why in the error message", async () => {
    await expect(
      getDb().delete(shipmentEvents).where(eq(shipmentEvents.shipmentId, shipment.id)),
    ).rejects.toSatisfy((error: unknown) =>
      /append-only: DELETE is not allowed/.test(String((error as Error).cause ?? error)),
    );
  });
});
