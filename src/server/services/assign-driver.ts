import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { DriverAssignment } from "@/domain/shipment-event";
import { canAssignDrivers, canChangeDriver } from "@/domain/shipment-permissions";
import type { ShipmentStatus } from "@/domain/shipment-status";
import type { AuthContext } from "@/server/auth/auth-context";
import { getDb } from "@/server/db/client";
import { shipmentEvents, shipments, type Shipment, type ShipmentEvent } from "@/server/db/schema";

import { isDriverInOrganization, NOT_AN_ORGANIZATION_DRIVER } from "./driver-membership";
import {
  forbidden,
  notFound,
  validationFailure,
  type Forbidden,
  type NotFound,
  type ValidationFailure,
} from "./results";
import { visibleShipments } from "./shipment-access";

export const assignDriverSchema = z.object({
  shipmentId: z.uuid(),
  /** The `version` the user saw when they opened the form. */
  expectedVersion: z.coerce.number().int().min(1),
  /**
   * The new driver's user id, or null to unassign. Required, so a forgotten field is an error
   * rather than a silent unassignment; a blank form value ("No driver") means null.
   */
  driverId: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.union([z.string().trim().max(100), z.null()], { error: "Choose a driver" }),
  ),
});

export type AssignDriverInput = z.input<typeof assignDriverSchema>;

export type AssignDriverResult =
  | { ok: true; shipment: Shipment; event: ShipmentEvent }
  /** Someone else changed the shipment first; `current` is the fresh data to show the user. */
  | { ok: false; reason: "conflict"; current: Shipment }
  /** Delivered and cancelled shipments keep their driver (see `canChangeDriver`). */
  | { ok: false; reason: "closed"; status: ShipmentStatus }
  | Forbidden
  | NotFound
  | ValidationFailure;

/**
 * Assigns a shipment to a driver, moves it to another driver, or unassigns it (`driverId: null`).
 * Admins and dispatchers only; the driver must be a `driver` member of the caller's organization.
 *
 * Like a status change, it uses optimistic concurrency and bumps `version`: the assignment form
 * was rendered from one version, and a form that is stale (someone reassigned or advanced the
 * shipment meanwhile) should be reported as a conflict, not silently win. The `driver_assigned`
 * event (internal history, old and new driver ids in `metadata`) is written in the same
 * transaction.
 */
export async function assignDriver(ctx: AuthContext, input: unknown): Promise<AssignDriverResult> {
  // Reveals nothing about any shipment: drivers may never assign, whatever the id.
  if (!canAssignDrivers(ctx.role)) return forbidden;

  const parsed = assignDriverSchema.safeParse(input);
  if (!parsed.success) {
    // A malformed id cannot match any shipment: report it like any other unknown id.
    const badId = parsed.error.issues.some((issue) => issue.path[0] === "shipmentId");
    return badId ? notFound : validationFailure(parsed.error);
  }
  const { shipmentId, expectedVersion, driverId } = parsed.data;

  if (driverId && !(await isDriverInOrganization(driverId, ctx.organizationId))) {
    return {
      ok: false,
      reason: "validation",
      fieldErrors: { driverId: [NOT_AN_ORGANIZATION_DRIVER] },
    };
  }

  return getDb().transaction(async (tx): Promise<AssignDriverResult> => {
    const findVisible = async () => {
      const [row] = await tx
        .select()
        .from(shipments)
        .where(and(eq(shipments.id, shipmentId), visibleShipments(ctx)))
        .limit(1);
      return row;
    };

    const current = await findVisible();
    if (!current) return notFound;
    // Version first, as for status changes: on a stale form, the other checks would answer a
    // question about data the user has not seen.
    if (current.version !== expectedVersion) return { ok: false, reason: "conflict", current };
    if (!canChangeDriver(current.status)) {
      return { ok: false, reason: "closed", status: current.status };
    }
    if (current.assignedDriverId === driverId) {
      return {
        ok: false,
        reason: "validation",
        fieldErrors: {
          driverId: [driverId ? "This driver is already assigned" : "No driver is assigned"],
        },
      };
    }

    // The guarded UPDATE is what prevents lost updates (see changeShipmentStatus): a concurrent
    // change bumps the version, and Postgres re-checks the condition after it commits.
    const [updated] = await tx
      .update(shipments)
      .set({ assignedDriverId: driverId, version: sql`${shipments.version} + 1` })
      .where(
        and(
          eq(shipments.id, shipmentId),
          visibleShipments(ctx),
          eq(shipments.version, expectedVersion),
        ),
      )
      .returning();
    if (!updated) {
      const latest = await findVisible();
      return latest ? { ok: false, reason: "conflict", current: latest } : notFound;
    }

    const metadata: DriverAssignment = {
      // Safe to take from the earlier read: the UPDATE matched the same version.
      fromDriverId: current.assignedDriverId,
      toDriverId: driverId,
    };
    const [event] = await tx
      .insert(shipmentEvents)
      .values({
        organizationId: ctx.organizationId,
        shipmentId,
        type: "driver_assigned",
        occurredAt: new Date(),
        actorUserId: ctx.userId,
        metadata,
      })
      .returning();

    return { ok: true, shipment: updated, event: event! };
  });
}
