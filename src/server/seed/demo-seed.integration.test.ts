import { asc, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { isOverdue } from "@/domain/driver-tasks";
import { canTransition, isTerminalStatus, SHIPMENT_STATUSES } from "@/domain/shipment-status";
import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db/client";
import { member, shipmentEvents, shipments, user } from "@/server/db/schema";

import { DEMO_PASSWORD, DEMO_USERS, seedDemo, type SeedResult } from "./demo-seed";

/** Smoke test so the seed cannot silently rot as services and rules change. */
describe("seedDemo", () => {
  const now = new Date();
  let result: SeedResult;

  beforeAll(async () => {
    result = await seedDemo({ now });
  }, 60_000);

  it("creates the three demo accounts with their roles, able to sign in", async () => {
    if (result.status !== "seeded") throw new Error("expected a fresh seed");
    const rows = await getDb()
      .select({ email: user.email, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, result.organizationId));

    expect(rows.sort((a, b) => a.email.localeCompare(b.email))).toEqual(
      DEMO_USERS.map(({ email, role }) => ({ email, role })).sort((a, b) =>
        a.email.localeCompare(b.email),
      ),
    );
    const signIn = await getAuth().api.signInEmail({
      body: { email: "driver@demo.test", password: DEMO_PASSWORD },
    });
    expect(signIn.user.email).toBe("driver@demo.test");
  });

  it("creates 30 shipments covering every status", async () => {
    if (result.status !== "seeded") throw new Error("expected a fresh seed");
    const rows = await getDb()
      .select({ status: shipments.status })
      .from(shipments)
      .where(eq(shipments.organizationId, result.organizationId));

    expect(rows).toHaveLength(30);
    expect(new Set(rows.map((row) => row.status))).toEqual(new Set(SHIPMENT_STATUSES));
  });

  it("gives every shipment a history that follows the state machine, in the past", async () => {
    if (result.status !== "seeded") throw new Error("expected a fresh seed");
    const seeded = await getDb()
      .select()
      .from(shipments)
      .where(eq(shipments.organizationId, result.organizationId));
    const events = await getDb()
      .select()
      .from(shipmentEvents)
      .where(
        inArray(
          shipmentEvents.shipmentId,
          seeded.map((shipment) => shipment.id),
        ),
      )
      .orderBy(asc(shipmentEvents.occurredAt), asc(shipmentEvents.recordedAt));

    for (const shipment of seeded) {
      const history = events.filter((event) => event.shipmentId === shipment.id);
      expect(history[0]).toMatchObject({ type: "created", toStatus: "created" });
      for (let i = 1; i < history.length; i++) {
        expect(canTransition(history[i - 1]!.toStatus!, history[i]!.toStatus!)).toBe(true);
        expect(history[i]!.fromStatus).toBe(history[i - 1]!.toStatus);
      }
      expect(history.at(-1)!.toStatus).toBe(shipment.status);
      expect(shipment.version).toBe(history.length);
      expect(history.at(-1)!.occurredAt.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it("keeps the demo believable: only a couple of unfinished shipments are overdue", async () => {
    if (result.status !== "seeded") throw new Error("expected a fresh seed");
    const seeded = await getDb()
      .select({
        status: shipments.status,
        promisedDeliveryAt: shipments.promisedDeliveryAt,
        assignedDriverId: shipments.assignedDriverId,
      })
      .from(shipments)
      .where(eq(shipments.organizationId, result.organizationId));
    const [driver] = await getDb()
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "driver@demo.test"));

    const unfinished = seeded.filter((shipment) => !isTerminalStatus(shipment.status));
    const overdue = unfinished.filter((shipment) => isOverdue(shipment, now));
    expect(overdue).toHaveLength(2);
    // Both on the demo driver's list, among more that are on time.
    const driversActive = unfinished.filter((shipment) => shipment.assignedDriverId === driver!.id);
    expect(overdue.every((shipment) => shipment.assignedDriverId === driver!.id)).toBe(true);
    expect(driversActive.length).toBeGreaterThan(4);
  });

  it("is a no-op when run again", async () => {
    expect(await seedDemo({ now })).toEqual({
      status: "skipped",
      reason: "admin@demo.test already exists",
    });
  });
});
